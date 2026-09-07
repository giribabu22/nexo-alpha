import { createHash } from "node:crypto";
import type {
  ApplicationState,
  NexoApi,
  NexoApplication,
  NexoJob,
  NexoService
} from "@nexo-alpha/core";
import {
  type ApplicationKnowledge,
  type DevelopmentState,
  type NexoConstraint,
  type NexoDecision
} from "./knowledge.js";

export interface ModuleContext {
  readonly name: string;
  readonly description?: string | undefined;
  readonly purpose?: string | undefined;
  readonly status?: string | undefined;
  readonly dependencies: readonly string[];
  readonly dependents: readonly string[];
  readonly apis: readonly NexoApi[];
  readonly services: readonly NexoService[];
  readonly events: readonly string[];
  readonly jobs: readonly NexoJob[];
  /** Declared implementing file paths. See `NexoModule.sourceFiles`. */
  readonly sourceFiles: readonly string[];
}

/** A declared dependency edge between a module and whatever it depends on. */
export interface DependencyEdge {
  readonly from: string;
  readonly to: string;
}

/**
 * A rollup of the application's registered structure — derived entirely
 * from `NexoApplication`'s own registry (modules, APIs, services, jobs,
 * declared dependencies), not from parsing source code. This is the
 * "what does the current registry look like" half of Knowledge, kept
 * separate from the human-authored decisions/constraints/history journal
 * in knowledge.ts; the two are joined only in {@link ApplicationContext}.
 */
export interface ApplicationStructure {
  readonly moduleCount: number;
  readonly apiCount: number;
  readonly serviceCount: number;
  readonly jobCount: number;
  readonly dependencyEdges: readonly DependencyEdge[];
}

/**
 * One scanned source file's path (relative to a project root, POSIX-style),
 * its best-effort exported symbol names, and its raw import specifiers as
 * written (e.g. `"./widget.js"`, `"node:fs"`, `"@nexo-alpha/core"`) —
 * unresolved. See {@link SourceTree.importEdges} for the subset of these
 * that could be resolved to another file within the same scanned tree.
 * This shape is produced by `@nexo-alpha/tools`'s `createSourceInterface()`
 * — defined here, not there, so `ApplicationContext` can reference it
 * without `@nexo-alpha/context` depending on `@nexo-alpha/tools`
 * (dependencies only ever point the other way in this framework).
 */
/**
 * A top-level declaration in a scanned file — a function, class, interface,
 * type alias, enum, or variable. Produced by `@nexo-alpha/tools`'s
 * `createSourceInterface()` from a real TypeScript AST walk (not regex).
 * `exported` reflects only an inline `export` modifier on the declaration
 * itself — a name re-exported later via a separate `export { x as y }`
 * statement still appears in the owning `SourceFile.exports`, just not
 * reflected back onto this flag, since that would require resolving the
 * export list against every local declaration rather than reading each
 * declaration in isolation.
 */
export interface SymbolInfo {
  readonly name: string;
  readonly kind: "function" | "class" | "interface" | "type" | "enum" | "variable";
  readonly exported: boolean;
  /** 1-based source line the declaration starts on. */
  readonly line: number;
}

export interface SourceFile {
  readonly path: string;
  readonly exports: readonly string[];
  readonly imports: readonly string[];
  /** Top-level declarations found in this file. See {@link SymbolInfo}. */
  readonly symbols: readonly SymbolInfo[];
}

/** A resolved import edge between two files within the same scanned source tree. */
export interface ImportEdge {
  readonly from: string;
  readonly to: string;
}

/** One endpoint of a {@link CallEdge} — a symbol within a specific file. */
export interface CallSite {
  readonly file: string;
  readonly symbol: string;
}

/**
 * A first-slice call edge: a direct call (`foo()`), constructor call
 * (`new Foo()`), or namespace-member call (`ns.foo()` through
 * `import * as ns from "..."`), from inside a top-level function
 * declaration or a top-level `const`/`let` bound to a function or arrow
 * expression, to an identifier that resolves either to another top-level
 * symbol in the same file, another file within the same scanned tree (via
 * an import), or an unresolved external package. Exactly one of
 * `to`/`toExternal` is present. A resolved constructor call's `to` points
 * at the class's own symbol — there's no separate "constructor" symbol,
 * since class members still aren't parsed at all.
 *
 * A fourth, narrower case is also captured: `obj.method()` where `obj` is
 * a local `const obj = new ClassName()` binding in the same scanned body.
 * Unlike everything else here, this is a heuristic, not a syntactic
 * certainty — `obj` could hold something other than what its initializer
 * suggests by the time `.method()` runs, and the class isn't checked for
 * actually declaring that method. Such an edge resolves to the class's own
 * symbol (same target a constructor call would use) and carries
 * `confidence: "heuristic"`; every other edge here stays exact, so the
 * field's absence still means "not guessed at." Only `const` bindings
 * qualify — `let` never produces a heuristic edge, even if it's factually
 * never reassigned, and a name rebound to two different classes in the
 * same body is treated as ambiguous and skipped rather than guessed at.
 *
 * Deliberately out of scope, same "not a full static-analysis engine"
 * stance as {@link ImportEdge}: calls inside class methods, constructor
 * calls through a property access (`new ns.Thing()`, `new obj.Thing()`),
 * and anything needing real type information. A callee that can't be
 * resolved to a known local symbol, import binding, or heuristic instance
 * binding is simply not recorded, not guessed at.
 */
export interface CallEdge {
  readonly from: CallSite;
  readonly to?: CallSite;
  readonly toExternal?: string;
  /** Present only for the heuristic `obj.method()` case described above. */
  readonly confidence?: "heuristic";
}

/** A file/export/import/symbol/call inventory produced by scanning a project's actual source tree. */
export interface SourceTree {
  readonly fileCount: number;
  readonly files: readonly SourceFile[];
  /**
   * Import edges resolved between files within this scanned tree only —
   * a relative import (`"./x"`) that resolved to a file this scan actually
   * found. A relative import that couldn't be matched to a scanned file,
   * and any bare package specifier (`"react"`, `"node:fs"`,
   * `"@nexo-alpha/core"`), is deliberately left out here — it's still
   * visible in the owning file's `imports` list, just not turned into an
   * edge to nowhere. This is a literal, file-level import graph, not a
   * symbol-level one: if file A re-exports from B which re-exports from
   * C, only the A→B and B→C edges exist, not A→C.
   */
  readonly importEdges: readonly ImportEdge[];
  /** First-slice call graph edges. See {@link CallEdge}. */
  readonly callEdges: readonly CallEdge[];
}

export interface ApplicationContext {
  readonly application: {
    readonly name: string;
    readonly version: string;
    readonly description?: string | undefined;
    readonly state: ApplicationState;
  };
  readonly modules: readonly ModuleContext[];
  readonly decisions: readonly NexoDecision[];
  readonly constraints: readonly NexoConstraint[];
  readonly developmentState: DevelopmentState;
  readonly structure: ApplicationStructure;
  /**
   * A deterministic hash of `structure` (see {@link hashStructure}). Lets a
   * consumer detect whether a previously captured context/knowledge
   * snapshot still reflects the application's current registered
   * structure, without re-diffing the whole manifest by hand.
   */
  readonly structureHash: string;
  /**
   * A source-tree scan, present only when one was supplied to
   * {@link buildContext}. Unlike `structure`, this isn't derived from the
   * application's registry — it comes from reading actual files — so it's
   * opt-in rather than always computed: scanning a source tree is real I/O,
   * scanning the registry is free.
   */
  readonly sourceTree?: SourceTree;
  /** A deterministic hash of `sourceTree` (see {@link hashSourceTree}); present iff `sourceTree` is. */
  readonly sourceTreeHash?: string;
}

/**
 * Computes an {@link ApplicationStructure} rollup directly from the
 * application's registry — no source parsing involved. `dependencyEdges`
 * is sorted (by `from`, then `to`) so the result — and therefore
 * {@link hashStructure}'s output — doesn't depend on module registration
 * order.
 */
export function describeStructure(app: NexoApplication): ApplicationStructure {
  const dependencyEdges: DependencyEdge[] = app
    .getModules()
    .flatMap((module) =>
      (module.dependencies ?? []).map((to) => ({ from: module.name, to }))
    )
    .sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));

  return {
    moduleCount: app.getModules().length,
    apiCount: app.getApis().length,
    serviceCount: app.getServices().length,
    jobCount: app.getJobs().length,
    dependencyEdges
  };
}

/**
 * Hashes an {@link ApplicationStructure} deterministically (SHA-256 over a
 * canonical JSON encoding), so two structures with identical content
 * always hash identically regardless of how they were produced.
 */
export function hashStructure(structure: ApplicationStructure): string {
  const canonical = JSON.stringify({
    moduleCount: structure.moduleCount,
    apiCount: structure.apiCount,
    serviceCount: structure.serviceCount,
    jobCount: structure.jobCount,
    dependencyEdges: structure.dependencyEdges.map((edge) => `${edge.from}->${edge.to}`)
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Hashes a {@link SourceTree} deterministically (SHA-256 over each file's
 * path, export list, and import list, plus the resolved import edges), so
 * re-scanning an unchanged tree always produces the same hash. The single
 * implementation lives here so `@nexo-alpha/tools`'s
 * `createSourceInterface()` and `buildContext()` never risk computing this
 * two different ways.
 */
/** The canonical per-file string {@link hashSourceTree} and {@link hashSourceFile} both hash — kept in one place so the two can never drift apart. */
function canonicalSourceFileString(file: SourceFile): string {
  return (
    `${file.path}:${file.exports.join(",")}:${file.imports.join(",")}:` +
    file.symbols.map((symbol) => `${symbol.name}/${symbol.kind}/${symbol.exported}`).join(",")
  );
}

export function hashSourceTree(tree: SourceTree): string {
  const canonical = JSON.stringify({
    files: tree.files.map(canonicalSourceFileString),
    importEdges: [...tree.importEdges]
      .map((edge) => `${edge.from}->${edge.to}`)
      .sort(),
    callEdges: [...tree.callEdges]
      .map(
        (edge) =>
          `${edge.from.file}#${edge.from.symbol}->${
            edge.to !== undefined ? `${edge.to.file}#${edge.to.symbol}` : `external:${edge.toExternal}`
          }${edge.confidence !== undefined ? `|${edge.confidence}` : ""}`
      )
      .sort()
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Hashes a single {@link SourceFile} deterministically, over the same
 * path/exports/imports/symbols fingerprint {@link hashSourceTree} uses
 * internally per file. This is the same detection granularity as the
 * whole-tree hash: a change to a function body, comment, or formatting
 * that doesn't add/remove/rename an export, import, or top-level symbol
 * is invisible here — this is a structural fingerprint, not a content
 * hash. Used by `@nexo-alpha/tools`'s per-file freshness diffing.
 */
export function hashSourceFile(file: SourceFile): string {
  return createHash("sha256").update(canonicalSourceFileString(file)).digest("hex");
}

/** {@link hashSourceFile} for every file in `tree`, keyed by {@link SourceFile.path}. */
export function hashSourceTreeFiles(tree: SourceTree): Record<string, string> {
  const result: Record<string, string> = {};
  for (const file of tree.files) {
    result[file.path] = hashSourceFile(file);
  }
  return result;
}

const EMPTY_DEVELOPMENT_STATE: DevelopmentState = {
  completed: [],
  inProgress: [],
  blocked: [],
  knownIssues: []
};

/**
 * Builds an ApplicationContext from the structural model plus optional
 * human-authored knowledge and an optional source-tree scan.
 *
 * @param app        The Nexo application (structure + lifecycle).
 * @param knowledge  Optional knowledge object created with createKnowledge().
 *                   When omitted, decisions/constraints/developmentState are
 *                   empty/default in the resulting context.
 * @param sourceTree Optional result of scanning the project's actual source
 *                   tree (e.g. via `@nexo-alpha/tools`'s
 *                   `createSourceInterface().describeSourceTree()`). When
 *                   omitted, `sourceTree`/`sourceTreeHash` are absent from
 *                   the resulting context entirely — this function never
 *                   does its own file I/O.
 */
export function buildContext(
  app: NexoApplication,
  knowledge?: ApplicationKnowledge,
  sourceTree?: SourceTree
): ApplicationContext {
  const modules = app.getModules().map((module): ModuleContext => ({
    name: module.name,
    ...(module.description !== undefined && { description: module.description }),
    ...(module.purpose !== undefined && { purpose: module.purpose }),
    ...(module.status !== undefined && { status: module.status }),
    dependencies: module.dependencies ?? [],
    dependents: app.getDependents(module.name),
    apis: module.apis ?? [],
    services: module.services ?? [],
    events: module.events ?? [],
    jobs: module.jobs ?? [],
    sourceFiles: module.sourceFiles ?? []
  }));

  const structure = describeStructure(app);

  return {
    application: {
      name: app.name,
      version: app.version,
      ...(app.description !== undefined && { description: app.description }),
      state: app.state
    },
    modules,
    decisions: knowledge?.getDecisions() ?? [],
    constraints: knowledge?.getConstraints() ?? [],
    developmentState: knowledge?.getDevelopmentState() ?? EMPTY_DEVELOPMENT_STATE,
    structure,
    structureHash: hashStructure(structure),
    ...(sourceTree !== undefined && {
      sourceTree,
      sourceTreeHash: hashSourceTree(sourceTree)
    })
  };
}

export function contextToJson(context: ApplicationContext): string {
  return JSON.stringify(context, null, 2);
}
