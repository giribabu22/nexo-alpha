export interface DevelopmentState {
  readonly currentObjective?: string;
  readonly completed: readonly string[];
  readonly inProgress: readonly string[];
  readonly blocked: readonly string[];
  readonly knownIssues: readonly string[];
  readonly nextStep?: string;
}
