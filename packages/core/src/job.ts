export interface NexoJob {
  readonly name: string;
  readonly description?: string;
  readonly schedule?: string;
}
