export interface NexoDecision {
  readonly title: string;
  readonly reason?: string;
  readonly alternatives?: string;
  readonly status?: string;
}

export interface NexoConstraint {
  readonly description: string;
  readonly reason?: string;
}

export interface DevelopmentState {
  readonly currentObjective?: string;
  readonly completed: readonly string[];
  readonly inProgress: readonly string[];
  readonly blocked: readonly string[];
  readonly knownIssues: readonly string[];
  readonly nextStep?: string;
}

export interface NexoHistoryEntry {
  readonly timestamp: string;
  readonly operation: string;
  readonly target?: string;
  readonly actor?: string;
  readonly result: "success" | "denied" | "failed";
  readonly detail?: string;
}

/**
 * What kind of thing a {@link NexoIntent} is attached to. `"component"` and
 * `"function"` have no corresponding structural node anywhere else in Nexo
 * (there is no frontend/component concept in `@nexo-alpha/core`, and
 * functions below the top-level-symbol scan aren't individually addressable)
 * — recording intent for them here doesn't require inventing that structural
 * concept, it just gives an entity a name an intent can point at.
 */
export type IntentEntityKind = "module" | "api" | "service" | "job" | "component" | "function" | "file";

/** Where an intent's subject actually lives, so an agent can jump straight to it. */
export interface NexoIntentEvidence {
  readonly file: string;
  readonly line?: number;
}

/**
 * The "why" behind a piece of the application — PRD section 13's Intent
 * concept. Distinct from a {@link NexoDecision} (a point-in-time architectural
 * choice, often not tied to one entity) and a {@link NexoConstraint} (a rule
 * that must hold): an intent explains why one named entity exists at all.
 * Recording these is opt-in and entity-scoped by design — the framework
 * should never require documenting every function, only the ones worth
 * explaining to a future reader (human or AI).
 */
export interface NexoIntent {
  readonly entityKind: IntentEntityKind;
  /** The entity's own name — e.g. a module/API/service/job name, a component name, or a bare function name. */
  readonly entityName: string;
  readonly purpose: string;
  /** Why it exists from a business/product standpoint, if different from `purpose`. */
  readonly businessReason?: string;
  /** Names of other entities (modules, services, external systems) this one depends on. Informational, like `NexoModule.dependencies`. */
  readonly dependencies?: readonly string[];
  readonly evidence?: NexoIntentEvidence;
}

/**
 * Human-authored knowledge about an application.
 *
 * Distinct from the structural model in @nexo-alpha/core, which describes
 * what the application IS (modules, APIs, services, lifecycle). Knowledge
 * describes what we know ABOUT the application: architectural decisions,
 * constraints, current development state, and an audit history of operations.
 *
 * Create with createKnowledge() and pass to buildContext() to include in the
 * application manifest, or to createReadInterface()/createWriteInterface() in
 * @nexo-alpha/tools so the AI interface can read and write it.
 */
export interface ApplicationKnowledge {
  addDecision(decision: NexoDecision): this;
  getDecisions(): readonly NexoDecision[];

  addConstraint(constraint: NexoConstraint): this;
  getConstraints(): readonly NexoConstraint[];

  /**
   * Shallow-merges a partial patch into the current development state.
   * Array fields (completed, inProgress, blocked, knownIssues) are replaced
   * wholesale — the caller owns the full list, not an append log.
   */
  setDevelopmentState(patch: Partial<DevelopmentState>): this;
  getDevelopmentState(): DevelopmentState;

  addHistoryEntry(entry: Omit<NexoHistoryEntry, "timestamp">): this;
  getHistory(): readonly NexoHistoryEntry[];

  addIntent(intent: NexoIntent): this;
  getIntents(): readonly NexoIntent[];
  /** Looks up the most recently recorded intent for one entity, or `undefined` if none was recorded. */
  getIntent(entityKind: IntentEntityKind, entityName: string): NexoIntent | undefined;
}

export function createKnowledge(): ApplicationKnowledge {
  const decisions: NexoDecision[] = [];
  const constraints: NexoConstraint[] = [];
  const history: NexoHistoryEntry[] = [];
  const intents: NexoIntent[] = [];
  let developmentState: DevelopmentState = {
    completed: [],
    inProgress: [],
    blocked: [],
    knownIssues: []
  };

  const knowledge: ApplicationKnowledge = {
    addDecision(decision) {
      decisions.push(decision);
      return knowledge;
    },

    getDecisions() {
      return [...decisions];
    },

    addConstraint(constraint) {
      constraints.push(constraint);
      return knowledge;
    },

    getConstraints() {
      return [...constraints];
    },

    setDevelopmentState(patch) {
      developmentState = { ...developmentState, ...patch };
      return knowledge;
    },

    getDevelopmentState() {
      return developmentState;
    },

    addHistoryEntry(entry) {
      history.push({ ...entry, timestamp: new Date().toISOString() });
      return knowledge;
    },

    getHistory() {
      return [...history];
    },

    addIntent(intent) {
      intents.push(intent);
      return knowledge;
    },

    getIntents() {
      return [...intents];
    },

    getIntent(entityKind, entityName) {
      return [...intents]
        .reverse()
        .find((intent) => intent.entityKind === entityKind && intent.entityName === entityName);
    }
  };

  return knowledge;
}

/**
 * The schema version of {@link SerializedKnowledge} produced by
 * {@link knowledgeToJson}. Bump this if the serialized shape changes in a
 * way that isn't backward-compatible with {@link knowledgeFromJson}.
 */
export const KNOWLEDGE_SCHEMA_VERSION = 2;

export interface SerializedKnowledge {
  readonly decisions: readonly NexoDecision[];
  readonly constraints: readonly NexoConstraint[];
  readonly developmentState: DevelopmentState;
  readonly history: readonly NexoHistoryEntry[];
  /** Added in schema version 2. Absent entirely when loading a version-1 snapshot — {@link knowledgeFromJson} treats that the same as an empty list. */
  readonly intents: readonly NexoIntent[];
  /**
   * ISO-8601 timestamp of when this snapshot was produced by
   * {@link knowledgeToJson}. Lets a consumer (an AI agent or a human) tell
   * how old a loaded knowledge file is relative to the current session —
   * this file itself carries no signal of whether the codebase has since
   * changed, only of when the journal was last written out.
   */
  readonly generatedAt: string;
  /** See {@link KNOWLEDGE_SCHEMA_VERSION}. */
  readonly schemaVersion: number;
}

export function knowledgeToJson(knowledge: ApplicationKnowledge): string {
  const data: SerializedKnowledge = {
    decisions: knowledge.getDecisions(),
    constraints: knowledge.getConstraints(),
    developmentState: knowledge.getDevelopmentState(),
    history: knowledge.getHistory(),
    intents: knowledge.getIntents(),
    generatedAt: new Date().toISOString(),
    schemaVersion: KNOWLEDGE_SCHEMA_VERSION
  };
  return JSON.stringify(data, null, 2);
}

export function knowledgeFromJson(json: string): ApplicationKnowledge {
  const parsed = JSON.parse(json) as Partial<SerializedKnowledge>;
  const knowledge = createKnowledge();

  for (const decision of parsed.decisions ?? []) {
    knowledge.addDecision(decision);
  }

  for (const constraint of parsed.constraints ?? []) {
    knowledge.addConstraint(constraint);
  }

  if (parsed.developmentState) {
    knowledge.setDevelopmentState(parsed.developmentState);
  }

  for (const entry of parsed.history ?? []) {
    const entryCopy = { ...entry };
    delete (entryCopy as { timestamp?: string }).timestamp;
    knowledge.addHistoryEntry(entryCopy);
  }

  for (const intent of parsed.intents ?? []) {
    knowledge.addIntent(intent);
  }

  return knowledge;
}
