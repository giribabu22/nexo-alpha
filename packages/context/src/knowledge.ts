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
}

export function createKnowledge(): ApplicationKnowledge {
  const decisions: NexoDecision[] = [];
  const constraints: NexoConstraint[] = [];
  const history: NexoHistoryEntry[] = [];
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
    }
  };

  return knowledge;
}

/**
 * The schema version of {@link SerializedKnowledge} produced by
 * {@link knowledgeToJson}. Bump this if the serialized shape changes in a
 * way that isn't backward-compatible with {@link knowledgeFromJson}.
 */
export const KNOWLEDGE_SCHEMA_VERSION = 1;

export interface SerializedKnowledge {
  readonly decisions: readonly NexoDecision[];
  readonly constraints: readonly NexoConstraint[];
  readonly developmentState: DevelopmentState;
  readonly history: readonly NexoHistoryEntry[];
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

  return knowledge;
}
