export class NexoError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);

    this.name = "NexoError";
    this.code = code;
  }
}

export class NexoConfigurationError extends NexoError {
  constructor(message: string) {
    super("NEXO_CONFIGURATION_ERROR", message);
    this.name = "NexoConfigurationError";
  }
}

export class NexoLifecycleError extends NexoError {
  constructor(message: string) {
    super("NEXO_LIFECYCLE_ERROR", message);
    this.name = "NexoLifecycleError";
  }
}
