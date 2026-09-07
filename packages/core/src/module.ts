export interface NexoModule {
  readonly name: string;
  readonly description?: string;

  initialize?(): Promise<void> | void;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
}
