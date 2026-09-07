import { readdir, readFile } from "node:fs/promises";
import { extname, join, posix, relative, sep } from "node:path";
import ts from "typescript";
import {
  hashSourceTree,
  type CallEdge,
  type CallSite,
  type ImportEdge,
  type SourceFile,
  type SourceTree,
  type SymbolInfo
} from "@nexo-alpha/context";

// Re-exported so existing consumers of @nexo-alpha/tools don't need to
// import these shapes from @nexo-alpha/context directly. They're defined
// there — not here — so that ApplicationContext (in @nexo-alpha/context)
// can reference them without @nexo-alpha/context depending on
// @nexo-alpha/tools; dependencies only ever point the other way in this
// framework.
export type { CallEdge, CallSite, ImportEdge, SourceFile, SourceTree, SymbolInfo };

export interface SourceInterfaceOptions {
  /** File extensions to include. Defaults to TypeScript/JavaScript source. */
  readonly extensions?: readonly string[];
  /** Directory names to never descend into, in addition to the defaults. */
  readonly ignore?: readonly string[];
}

export interface NexoSourceInterface {
  /** Walks the project tree and extracts a file/export/import/symbol/call inventory. */
  describeSourceTree(): Promise<SourceTree>;
  /**
   * Hashes a {@link SourceTree} deterministically (SHA-256 over each
   * file's path, export/import/symbol lists, and edges), so re-scanning
   * an unchanged tree always produces the same hash — usable as a
   * staleness signal for anything that was derived from a previous scan.
   */
  sourceTreeHash(tree: SourceTree): string;
}

const DEFAULT_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".js", ".jsx"];
const DEFAULT_IGNORE: readonly string[] = [
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".turbo"
];

function stripKnownExtension(path: string, extensions: readonly string[]): string {
  const match = extensions.find((extension) => path.endsWith(extension));
  return match !== undefined ? path.slice(0, -match.length) : path;
}

/**
 * Resolves a relative import specifier written in `fromPath` to another
 * file within the same scan.
 *
 * Tries, in order: the specifier as-is (handles a same-extension or
 * extensionless-source import); with any extension it already ends in
 * stripped and each of `extensions` tried in its place (handles the
 * TypeScript NodeNext convention this very repo uses throughout — writing
 * `"./context.js"` in an import while the real file is `context.ts`); and
 * finally as a directory index file. Returns `undefined` for anything that
 * doesn't resolve to a known file — a bare package specifier, a relative
 * import to a file outside the scanned extensions (e.g. `.json`), or a
 * genuinely missing import.
 */
function resolveInternalImport(
  fromPath: string,
  specifier: string,
  knownPaths: ReadonlySet<string>,
  extensions: readonly string[]
): string | undefined {
  const joined = posix.normalize(posix.join(posix.dirname(fromPath), specifier));

  if (knownPaths.has(joined)) {
    return joined;
  }

  const base = stripKnownExtension(joined, extensions);

  for (const extension of extensions) {
    if (knownPaths.has(`${base}${extension}`)) {
      return `${base}${extension}`;
    }
  }

  for (const extension of extensions) {
    const indexPath = posix.join(base, `index${extension}`);
    if (knownPaths.has(indexPath)) {
      return indexPath;
    }
  }

  return undefined;
}

async function walk(
  dir: string,
  extensions: ReadonlySet<string>,
  ignore: ReadonlySet<string>,
  acc: string[]
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") || ignore.has(entry.name)) {
      continue;
    }

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(fullPath, extensions, ignore, acc);
    } else if (entry.isFile() && extensions.has(extname(entry.name))) {
      acc.push(fullPath);
    }
  }

  return acc;
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function isExported(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function isDefaultExport(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.DefaultKeyword);
}

/** True for a variable initializer that makes the declaration "callable" for call-edge purposes. */
function isFunctionLike(initializer: ts.Expression | undefined): boolean {
  return (
    initializer !== undefined &&
    (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
  );
}

interface LocalSymbol {
  readonly name: string;
  readonly kind: SymbolInfo["kind"];
  readonly exported: boolean;
  readonly line: number;
  /** The node whose body (if any) should be scanned for outgoing calls. */
  readonly body?: ts.Node;
}

/** Extracts top-level declarations from a source file's immediate statements only (not nested scopes). */
function extractSymbols(sourceFile: ts.SourceFile): LocalSymbol[] {
  const symbols: LocalSymbol[] = [];

  const lineOf = (node: ts.Node): number =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      symbols.push({
        name: statement.name.text,
        kind: "function",
        exported: isExported(statement),
        line: lineOf(statement),
        ...(statement.body !== undefined && { body: statement.body })
      });
    } else if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
      symbols.push({
        name: statement.name.text,
        kind: "class",
        exported: isExported(statement),
        line: lineOf(statement)
      });
    } else if (ts.isInterfaceDeclaration(statement)) {
      symbols.push({
        name: statement.name.text,
        kind: "interface",
        exported: isExported(statement),
        line: lineOf(statement)
      });
    } else if (ts.isTypeAliasDeclaration(statement)) {
      symbols.push({
        name: statement.name.text,
        kind: "type",
        exported: isExported(statement),
        line: lineOf(statement)
      });
    } else if (ts.isEnumDeclaration(statement)) {
      symbols.push({
        name: statement.name.text,
        kind: "enum",
        exported: isExported(statement),
        line: lineOf(statement)
      });
    } else if (ts.isVariableStatement(statement)) {
      const exported = isExported(statement);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }
        const functionLike = isFunctionLike(declaration.initializer);
        symbols.push({
          name: declaration.name.text,
          kind: functionLike ? "function" : "variable",
          exported,
          line: lineOf(declaration),
          ...(functionLike ? { body: (declaration.initializer as ts.ArrowFunction | ts.FunctionExpression).body } : {})
        });
      }
    }
  }

  return symbols;
}

/** Named export identifiers surfaced by `export { a, b as c }` and `export default ...`. */
function extractExportedNames(sourceFile: ts.SourceFile, localSymbols: readonly LocalSymbol[]): Set<string> {
  const names = new Set<string>();

  for (const symbol of localSymbols) {
    if (symbol.exported && !isSymbolAlsoDefault(symbol, sourceFile)) {
      names.add(symbol.name);
    }
  }

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          names.add(element.name.text);
        }
      }
    } else if (ts.isExportAssignment(statement) && statement.isExportEquals !== true) {
      names.add("default");
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      isExported(statement) &&
      isDefaultExport(statement)
    ) {
      names.add("default");
    }
  }

  return names;
}

/**
 * A top-level `export default function name() {}` / `export default class
 * Name {}` is recorded in `exports` as `"default"` only — matching this
 * scanner's original regex-based behavior, where `export default` was
 * detected independently of the declaration's own name.
 */
function isSymbolAlsoDefault(symbol: LocalSymbol, sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name?.text === symbol.name &&
      isExported(statement) &&
      isDefaultExport(statement)
    ) {
      return true;
    }
  }
  return false;
}

function extractImportSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if ((isRequire || isDynamicImport) && node.arguments.length > 0) {
        const [first] = node.arguments;
        if (first !== undefined && ts.isStringLiteral(first)) {
          specifiers.add(first.text);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);

  return [...specifiers].sort();
}

/** Local binding name -> the module specifier and exported name it came from. */
interface ImportBinding {
  readonly specifier: string;
  /** The name as exported by the source module ("default" for a default import). */
  readonly importedName: string;
}

function extractImportBindings(sourceFile: ts.SourceFile): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause === undefined) {
      continue;
    }

    if (clause.name !== undefined) {
      bindings.set(clause.name.text, { specifier, importedName: "default" });
    }

    if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        bindings.set(element.name.text, { specifier, importedName });
      }
    }
  }

  return bindings;
}

/** Direct calls (`foo()`) found anywhere within `body`, keyed by the callee identifier's text. */
function extractCallCallees(body: ts.Node): string[] {
  const callees: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      callees.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(body, visit);

  return callees;
}

function extractCallEdges(
  filePath: string,
  localSymbols: readonly LocalSymbol[],
  importBindings: ReadonlyMap<string, ImportBinding>,
  knownPaths: ReadonlySet<string>,
  extensions: readonly string[]
): CallEdge[] {
  const localSymbolNames = new Set(localSymbols.map((symbol) => symbol.name));
  const edges: CallEdge[] = [];

  for (const symbol of localSymbols) {
    if (symbol.body === undefined) {
      continue;
    }

    for (const callee of extractCallCallees(symbol.body)) {
      const from: CallSite = { file: filePath, symbol: symbol.name };

      if (localSymbolNames.has(callee) && callee !== symbol.name) {
        edges.push({ from, to: { file: filePath, symbol: callee } });
        continue;
      }

      const binding = importBindings.get(callee);
      if (binding === undefined) {
        continue;
      }

      const resolvedFile = binding.specifier.startsWith(".")
        ? resolveInternalImport(filePath, binding.specifier, knownPaths, extensions)
        : undefined;

      if (resolvedFile !== undefined) {
        edges.push({ from, to: { file: resolvedFile, symbol: binding.importedName } });
      } else {
        edges.push({ from, toExternal: binding.specifier });
      }
    }
  }

  return edges;
}

function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".ts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/**
 * Extracts a per-file export/import/symbol/call inventory from the
 * project's source tree — the "what files exist, what do they expose, what
 * do they pull in, and how do they call each other" half of codebase
 * understanding that {@link "@nexo-alpha/context"}'s `describeStructure()`
 * can't provide, since that reads only what's been registered with
 * `NexoApplication`, not the source tree itself.
 *
 * Parsing uses the real TypeScript AST (`ts.createSourceFile`, syntactic
 * only — no `Program`/type-checker, so no cross-project module resolution
 * or type information is used). This is deliberately still not a full
 * static-analysis engine: no type-aware call resolution, no method calls
 * (`obj.method()`), no constructor calls (`new X()`), and import resolution
 * is limited to relative specifiers that land on another file this same
 * scan found — a bare package specifier (`"react"`, `"node:fs"`,
 * `"@nexo-alpha/core"`) is recorded per-file but never turned into a graph
 * edge, since resolving it would mean fully replicating Node's module
 * resolution algorithm across `node_modules`.
 */
export function createSourceInterface(
  projectRoot: string,
  options: SourceInterfaceOptions = {}
): NexoSourceInterface {
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS);
  const resolutionExtensions = [...extensions];
  const ignore = new Set([...DEFAULT_IGNORE, ...(options.ignore ?? [])]);

  return {
    async describeSourceTree() {
      const absolutePaths = (await walk(projectRoot, extensions, ignore, [])).sort();

      const parsed = await Promise.all(
        absolutePaths.map(async (absolutePath) => {
          const path = toPosixPath(relative(projectRoot, absolutePath));
          const contents = await readFile(absolutePath, "utf8");
          const sourceFile = ts.createSourceFile(
            path,
            contents,
            ts.ScriptTarget.Latest,
            true,
            scriptKindFor(path)
          );
          const localSymbols = extractSymbols(sourceFile);
          return { path, sourceFile, localSymbols };
        })
      );

      const knownPaths = new Set(parsed.map((entry) => entry.path));

      const files: SourceFile[] = parsed.map(({ path, sourceFile, localSymbols }) => ({
        path,
        exports: [...extractExportedNames(sourceFile, localSymbols)].sort(),
        imports: extractImportSpecifiers(sourceFile),
        symbols: localSymbols.map(
          (symbol): SymbolInfo => ({
            name: symbol.name,
            kind: symbol.kind,
            exported: symbol.exported,
            line: symbol.line
          })
        )
      }));

      const importEdges: ImportEdge[] = files
        .flatMap((file) =>
          file.imports
            .filter((specifier) => specifier.startsWith("."))
            .map((specifier) => resolveInternalImport(file.path, specifier, knownPaths, resolutionExtensions))
            .filter((to): to is string => to !== undefined)
            .map((to) => ({ from: file.path, to }))
        )
        .sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));

      const callEdges: CallEdge[] = parsed
        .flatMap(({ path, sourceFile, localSymbols }) =>
          extractCallEdges(
            path,
            localSymbols,
            extractImportBindings(sourceFile),
            knownPaths,
            resolutionExtensions
          )
        )
        .sort((a, b) => {
          const key = (edge: CallEdge): string =>
            `${edge.from.file}#${edge.from.symbol}->${
              edge.to !== undefined ? `${edge.to.file}#${edge.to.symbol}` : `external:${edge.toExternal}`
            }`;
          return key(a).localeCompare(key(b));
        });

      return { fileCount: files.length, files, importEdges, callEdges };
    },

    sourceTreeHash(tree) {
      return hashSourceTree(tree);
    }
  };
}
