export type NexoJobRunner = () => unknown | Promise<unknown>;

export interface NexoJob {
  readonly name: string;
  readonly description?: string;
  readonly schedule?: string;
  readonly run?: NexoJobRunner;
}
