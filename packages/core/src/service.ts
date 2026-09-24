export interface NexoServiceDefinition {
  readonly name: string;
  readonly description?: string | undefined;
  readonly purpose?: string | undefined;
  readonly dependencies?: readonly string[] | undefined;
  onStart?(): Promise<void> | void;
  onStop?(): Promise<void> | void;
}

export class NexoService implements NexoServiceDefinition {
  readonly name: string;
  readonly description?: string | undefined;
  readonly purpose?: string | undefined;
  readonly dependencies?: readonly string[] | undefined;

  constructor(options: {
    readonly name: string;
    readonly description?: string | undefined;
    readonly purpose?: string | undefined;
    readonly dependencies?: readonly string[] | undefined;
  }) {
    this.name = options.name;
    this.description = options.description;
    this.purpose = options.purpose;
    this.dependencies = options.dependencies;
  }

  onStart?(): Promise<void> | void {}
  onStop?(): Promise<void> | void {}
}
