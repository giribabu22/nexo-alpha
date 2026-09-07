export interface NexoHistoryEntry {
  readonly timestamp: string;
  readonly operation: string;
  readonly target?: string;
  readonly actor?: string;
  readonly result: "success" | "denied" | "failed";
  readonly detail?: string;
}
