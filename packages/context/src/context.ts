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

const EMPTY_DEVELOPMENT_STATE: DevelopmentState = {
  completed: [],
  inProgress: [],
  blocked: [],
  knownIssues: []
};

/**
 * Builds an ApplicationContext from the structural model plus optional
 * human-authored knowledge.
 *
 * @param app      The Nexo application (structure + lifecycle).
 * @param knowledge Optional knowledge object created with createKnowledge().
 *                  When omitted, decisions/constraints/developmentState are
 *                  empty/default in the resulting context.
 */
export function buildContext(
  app: NexoApplication,
  knowledge?: ApplicationKnowledge
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
    jobs: module.jobs ?? []
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
    structureHash: hashStructure(structure)
  };
}

export function contextToJson(context: ApplicationContext): string {
  return JSON.stringify(context, null, 2);
}
