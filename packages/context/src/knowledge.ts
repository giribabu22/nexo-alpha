export interface NexoDecision {
  readonly title: string;
  readonly reason?: string;
  readonly alternatives?: string;
  readonly status?: string;
  readonly tags?: readonly string[];
  readonly category?: string;
}

export interface NexoConstraint {
  readonly description: string;
  readonly reason?: string;
  readonly category?: string;
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

export type IntentEntityKind = "module" | "api" | "service" | "job" | "component" | "function" | "file";

export interface NexoIntentEvidence {
  readonly file: string;
  readonly line?: number;
}

export interface NexoIntent {
  readonly entityKind: IntentEntityKind;
  readonly entityName: string;
  readonly purpose: string;
  readonly businessReason?: string;
  readonly dependencies?: readonly string[];
  readonly evidence?: NexoIntentEvidence;
}

export interface KnowledgeSearchDecisionsOptions {
  readonly status?: string;
  readonly query?: string;
  readonly tag?: string;
  readonly category?: string;
}

export interface KnowledgeSearchConstraintsOptions {
  readonly query?: string;
  readonly category?: string;
}

export interface KnowledgeSearchIntentsOptions {
  readonly entityKind?: IntentEntityKind;
  readonly entityName?: string;
  readonly query?: string;
  readonly dependency?: string;
}

export interface KnowledgeSummary {
  readonly totalDecisions: number;
  readonly decisionsByStatus: Readonly<Record<string, number>>;
  readonly totalConstraints: number;
  readonly totalIntents: number;
  readonly intentsByKind: Readonly<Record<string, number>>;
  readonly totalHistoryEntries: number;
  readonly developmentState: {
    readonly objective?: string | undefined;
    readonly completedCount: number;
    readonly inProgressCount: number;
    readonly blockedCount: number;
    readonly knownIssuesCount: number;
    readonly progressRatio: number;
  };
}

export interface ApplicationKnowledge {
  addDecision(decision: NexoDecision): this;
  getDecisions(): readonly NexoDecision[];
  searchDecisions(options?: KnowledgeSearchDecisionsOptions): readonly NexoDecision[];

  addConstraint(constraint: NexoConstraint): this;
  getConstraints(): readonly NexoConstraint[];
  searchConstraints(options?: KnowledgeSearchConstraintsOptions): readonly NexoConstraint[];

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
  searchIntents(options?: KnowledgeSearchIntentsOptions): readonly NexoIntent[];
  getIntentsByDependency(dependencyName: string): readonly NexoIntent[];

  /** High-level metrics and health snapshot of the documented application knowledge. */
  getKnowledgeSummary(): KnowledgeSummary;
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

    searchDecisions(options = {}) {
      const q = options.query?.toLowerCase();
      const status = options.status?.toLowerCase();
      const tag = options.tag?.toLowerCase();
      const category = options.category?.toLowerCase();

      return decisions.filter((d) => {
        if (status !== undefined && (d.status?.toLowerCase() ?? "") !== status) return false;
        if (category !== undefined && (d.category?.toLowerCase() ?? "") !== category) return false;
        if (tag !== undefined && !(d.tags?.some((t) => t.toLowerCase() === tag) ?? false)) return false;
        if (q !== undefined) {
          const matchTitle = d.title.toLowerCase().includes(q);
          const matchReason = d.reason?.toLowerCase().includes(q) ?? false;
          const matchAlts = d.alternatives?.toLowerCase().includes(q) ?? false;
          if (!matchTitle && !matchReason && !matchAlts) return false;
        }
        return true;
      });
    },

    addConstraint(constraint) {
      constraints.push(constraint);
      return knowledge;
    },

    getConstraints() {
      return [...constraints];
    },

    searchConstraints(options = {}) {
      const q = options.query?.toLowerCase();
      const category = options.category?.toLowerCase();

      return constraints.filter((c) => {
        if (category !== undefined && (c.category?.toLowerCase() ?? "") !== category) return false;
        if (q !== undefined) {
          const matchDesc = c.description.toLowerCase().includes(q);
          const matchReason = c.reason?.toLowerCase().includes(q) ?? false;
          if (!matchDesc && !matchReason) return false;
        }
        return true;
      });
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
    },

    searchIntents(options = {}) {
      const q = options.query?.toLowerCase();
      const kind = options.entityKind;
      const name = options.entityName?.toLowerCase();
      const dep = options.dependency?.toLowerCase();

      return intents.filter((i) => {
        if (kind !== undefined && i.entityKind !== kind) return false;
        if (name !== undefined && i.entityName.toLowerCase() !== name) return false;
        if (dep !== undefined && !(i.dependencies?.some((d: string) => d.toLowerCase() === dep) ?? false)) return false;
        if (q !== undefined) {
          const matchName = i.entityName.toLowerCase().includes(q);
          const matchPurpose = i.purpose.toLowerCase().includes(q);
          const matchBiz = i.businessReason?.toLowerCase().includes(q) ?? false;
          if (!matchName && !matchPurpose && !matchBiz) return false;
        }
        return true;
      });
    },

    getIntentsByDependency(dependencyName: string) {
      const target = dependencyName.toLowerCase();
      return intents.filter((i) => i.dependencies?.some((d: string) => d.toLowerCase() === target) ?? false);
    },

    getKnowledgeSummary() {
      const decisionsByStatus: Record<string, number> = {};
      for (const d of decisions) {
        const s = d.status ?? "unspecified";
        decisionsByStatus[s] = (decisionsByStatus[s] ?? 0) + 1;
      }

      const intentsByKind: Record<string, number> = {};
      for (const i of intents) {
        intentsByKind[i.entityKind] = (intentsByKind[i.entityKind] ?? 0) + 1;
      }

      const totalWorkItems =
        developmentState.completed.length +
        developmentState.inProgress.length +
        developmentState.blocked.length;
      const progressRatio =
        totalWorkItems > 0
          ? Math.round((developmentState.completed.length / totalWorkItems) * 100) / 100
          : 0;

      return {
        totalDecisions: decisions.length,
        decisionsByStatus,
        totalConstraints: constraints.length,
        totalIntents: intents.length,
        intentsByKind,
        totalHistoryEntries: history.length,
        developmentState: {
          objective: developmentState.currentObjective,
          completedCount: developmentState.completed.length,
          inProgressCount: developmentState.inProgress.length,
          blockedCount: developmentState.blocked.length,
          knownIssuesCount: developmentState.knownIssues.length,
          progressRatio
        }
      };
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
