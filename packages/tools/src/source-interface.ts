import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { hashSourceTree, type SourceFile, type SourceTree } from "@nexo-alpha/context";

// Re-exported so existing consumers of @nexo-alpha/tools don't need to
// import these shapes from @nexo-alpha/context directly. They're defined
// there — not here — so that ApplicationContext (in @nexo-alpha/context)
// can reference them without @nexo-alpha/context depending on
// @nexo-alpha/tools; dependencies only ever point the other way in this
// framework.
export type { SourceFile, SourceTree };

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
 * Extracts a lightweight, per-file export inventory from the project's
 * source tree — the "what files exist and what do they expose" half of
 * codebase understanding that {@link "@nexo-alpha/context"}'s
 * `describeStructure()` can't provide, since that reads only what's been
 * registered with `NexoApplication`, not the source tree itself.
 *
 * This is deliberately not a full static-analysis engine: no AST, no
 * import-graph resolution, no cross-file symbol tracking. It answers
 * "what does this file export" cheaply and without a parser dependency;
 * building a precise code graph (real import edges, call graphs, symbol
 * usage) is separate, larger scope this does not attempt.
 */
export function createSourceInterface(
  projectRoot: string,
  options: SourceInterfaceOptions = {}
): NexoSourceInterface {
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS);
  const ignore = new Set([...DEFAULT_IGNORE, ...(options.ignore ?? [])]);

  return {
    async describeSourceTree() {
      const absolutePaths = (await walk(projectRoot, extensions, ignore, [])).sort();

      const files: SourceFile[] = await Promise.all(
        absolutePaths.map(async (absolutePath) => {
          const contents = await readFile(absolutePath, "utf8");
          return {
            path: toPosixPath(relative(projectRoot, absolutePath)),
            exports: extractExports(contents)
          };
        })
      );

      return { fileCount: files.length, files };
    },

    sourceTreeHash(tree) {
      return hashSourceTree(tree);
    }
  };
}
