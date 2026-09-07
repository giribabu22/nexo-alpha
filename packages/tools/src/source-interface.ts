import { readdir, readFile } from "node:fs/promises";
import { extname, join, posix, relative, sep } from "node:path";
import {
  hashSourceTree,
  type ImportEdge,
  type SourceFile,
  type SourceTree
} from "@nexo-alpha/context";

// Re-exported so existing consumers of @nexo-alpha/tools don't need to
// import these shapes from @nexo-alpha/context directly. They're defined
// there — not here — so that ApplicationContext (in @nexo-alpha/context)
// can reference them without @nexo-alpha/context depending on
// @nexo-alpha/tools; dependencies only ever point the other way in this
// framework.
export type { ImportEdge, SourceFile, SourceTree };

export interface SourceInterfaceOptions {
  /** File extensions to include. Defaults to TypeScript/JavaScript source. */
  readonly extensions?: readonly string[];
  /** Directory names to never descend into, in addition to the defaults. */
  readonly ignore?: readonly string[];
}

export interface NexoSourceInterface {
  /** Walks the project tree and extracts a file/export inventory. */
  describeSourceTree(): Promise<SourceTree>;
  /**
   * Hashes a {@link SourceTree} deterministically (SHA-256 over each
   * file's path and export list), so re-scanning an unchanged tree always
   * produces the same hash — usable as a staleness signal for anything
   * that was derived from a previous scan.
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

// Deliberately conservative: matches common export forms without needing a
// real TypeScript/JS parser as a dependency. See SourceFile.exports for the
// tradeoffs this implies.
const NAMED_EXPORT_PATTERNS: readonly RegExp[] = [
  /export\s+(?:async\s+)?function\s*\*?\s+([A-Za-z0-9_$]+)/g,
  /export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/g,
  /export\s+interface\s+([A-Za-z0-9_$]+)/g,
  /export\s+type\s+([A-Za-z0-9_$]+)/g,
  /export\s+enum\s+([A-Za-z0-9_$]+)/g,
  /export\s+const\s+([A-Za-z0-9_$]+)/g,
  /export\s+let\s+([A-Za-z0-9_$]+)/g,
  /export\s+var\s+([A-Za-z0-9_$]+)/g
];

const EXPORT_LIST_PATTERN = /export\s*\{([^}]+)\}/g;
const DEFAULT_EXPORT_PATTERN = /export\s+default\b/;

// Same tradeoff as the export patterns above: regex, not a parser. These
// cover the common forms (static import/export-from, require(), dynamic
// import()) on a single logical statement per match — the character class
// excludes newlines and quotes so a match can't accidentally span into an
// unrelated statement later in the file.
const IMPORT_PATTERNS: readonly RegExp[] = [
  /\bimport\s+[^'";\n]*?\sfrom\s+["']([^"']+)["']/g,
  /\bimport\s+["']([^"']+)["']\s*;?/g,
  /\bexport\s+(?:\*(?:\s+as\s+[A-Za-z0-9_$]+)?|\{[^}]*\})\s+from\s+["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g
];

function extractImports(source: string): string[] {
  const specifiers = new Set<string>();

  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        specifiers.add(specifier);
      }
    }
  }

  return [...specifiers].sort();
}

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

function extractExports(source: string): string[] {
  const names = new Set<string>();

  for (const pattern of NAMED_EXPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (name !== undefined) {
        names.add(name);
      }
    }
  }

  for (const match of source.matchAll(EXPORT_LIST_PATTERN)) {
    const exportList = match[1];
    if (exportList === undefined) {
      continue;
    }

    for (const part of exportList.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const asMatch = /^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/.exec(trimmed);
      const aliased = asMatch?.[2];
      names.add(aliased ?? trimmed);
    }
  }

  if (DEFAULT_EXPORT_PATTERN.test(source)) {
    names.add("default");
  }

  return [...names].sort();
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

/**
 * Extracts a lightweight, per-file export/import inventory from the
 * project's source tree — the "what files exist, what do they expose, and
 * what do they pull in" half of codebase understanding that
 * {@link "@nexo-alpha/context"}'s `describeStructure()` can't provide,
 * since that reads only what's been registered with `NexoApplication`,
 * not the source tree itself.
 *
 * This is deliberately not a full static-analysis engine: no AST, no
 * cross-file symbol tracking, and import resolution is limited to relative
 * specifiers that land on another file this same scan found — a bare
 * package specifier (`"react"`, `"node:fs"`, `"@nexo-alpha/core"`) is
 * recorded per-file but never turned into a graph edge, since resolving it
 * would mean fully replicating Node's module resolution algorithm across
 * `node_modules`. It answers "what does this file export/import" cheaply
 * and without a parser dependency; a precise code graph (call graphs,
 * symbol usage, full module resolution) is separate, larger scope this
 * does not attempt.
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

      const files: SourceFile[] = await Promise.all(
        absolutePaths.map(async (absolutePath) => {
          const contents = await readFile(absolutePath, "utf8");
          return {
            path: toPosixPath(relative(projectRoot, absolutePath)),
            exports: extractExports(contents),
            imports: extractImports(contents)
          };
        })
      );

      const knownPaths = new Set(files.map((file) => file.path));
      const importEdges: ImportEdge[] = files
        .flatMap((file) =>
          file.imports
            .filter((specifier) => specifier.startsWith("."))
            .map((specifier) => resolveInternalImport(file.path, specifier, knownPaths, resolutionExtensions))
            .filter((to): to is string => to !== undefined)
            .map((to) => ({ from: file.path, to }))
        )
        .sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));

      return { fileCount: files.length, files, importEdges };
    },

    sourceTreeHash(tree) {
      return hashSourceTree(tree);
    }
  };
}
