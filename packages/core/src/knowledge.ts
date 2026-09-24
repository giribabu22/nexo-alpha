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
