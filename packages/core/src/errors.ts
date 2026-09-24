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

export class NexoResolutionError extends NexoError {
  constructor(message: string) {
    super("NEXO_RESOLUTION_ERROR", message);
    this.name = "NexoResolutionError";
  }
}

export class NexoPluginError extends NexoError {
  constructor(message: string) {
    super("NEXO_PLUGIN_ERROR", message);
    this.name = "NexoPluginError";
  }
}

export class NexoValidationError extends NexoError {
  readonly errors: readonly string[];

  constructor(message: string, errors: readonly string[] = []) {
    super("NEXO_VALIDATION_ERROR", message);
    this.name = "NexoValidationError";
    this.errors = errors;
  }
}

export class NexoAuthenticationError extends NexoError {
  constructor(message: string) {
    super("NEXO_AUTHENTICATION_ERROR", message);
    this.name = "NexoAuthenticationError";
  }
}
