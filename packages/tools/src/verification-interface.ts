import type { ApplicationState, NexoApplication } from "@nexo-alpha/core";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  readonly severity: ValidationSeverity;
  readonly message: string;
  readonly target?: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

export interface DependencyGraphEntry {
  readonly module: string;
  readonly dependencies: readonly string[];
  readonly dependents: readonly string[];
}

export interface ApplicationHealth {
  readonly state: ApplicationState;
  readonly moduleCount: number;
  readonly apiCount: number;
  readonly serviceCount: number;
  readonly architecture: ValidationResult;
}

export interface NexoVerificationInterface {
  validateConfiguration(): ValidationResult;
  validateArchitecture(): ValidationResult;
  inspectDependencies(): readonly DependencyGraphEntry[];
  checkApplicationHealth(): ApplicationHealth;
}

function toValidationResult(issues: readonly ValidationIssue[]): ValidationResult {
  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issues
  };
}

function detectCycle(
  moduleName: string,
  moduleNames: ReadonlySet<string>,
  getDependencies: (name: string) => readonly string[],
  state: Map<string, "visiting" | "done">,
  path: string[]
): string[] | undefined {
  state.set(moduleName, "visiting");
  path.push(moduleName);

  for (const dependency of getDependencies(moduleName)) {
    if (dependency === moduleName || !moduleNames.has(dependency)) {
      continue;
    }

    const dependencyState = state.get(dependency);

    if (dependencyState === "visiting") {
      const cycleStart = path.indexOf(dependency);
      return [...path.slice(cycleStart), dependency];
    }

    if (dependencyState !== "done") {
      const cycle = detectCycle(dependency, moduleNames, getDependencies, state, path);
      if (cycle) {
        return cycle;
      }
    }
  }

  path.pop();
  state.set(moduleName, "done");
  return undefined;
}

export function createVerificationInterface(
  app: NexoApplication
): NexoVerificationInterface {
  return {
    validateConfiguration() {
      const issues: ValidationIssue[] = [];
      const config = app.getAllConfig();

      for (const [key, value] of Object.entries(config)) {
        if (typeof value === "function") {
          issues.push({
            severity: "warning",
            message: `Configuration key "${key}" holds a function, which will be silently dropped when serialized to JSON.`,
            target: key
          });
        }
      }

      try {
        JSON.stringify(config);
      } catch (error) {
        issues.push({
          severity: "error",
          message: `Configuration is not JSON-serializable: ${(error as Error).message}`
        });
      }

      return toValidationResult(issues);
    },

    validateArchitecture() {
      const issues: ValidationIssue[] = [];
      const moduleNames = new Set(app.getModules().map((module) => module.name));

      for (const module of app.getModules()) {
        const dependencies = app.getDependencies(module.name);

        if (dependencies.includes(module.name)) {
          issues.push({
            severity: "error",
            message: `Module "${module.name}" depends on itself.`,
            target: module.name
          });
        }

        for (const dependency of dependencies) {
          if (dependency !== module.name && !moduleNames.has(dependency)) {
            issues.push({
              severity: "warning",
              message: `Module "${module.name}" depends on "${dependency}", which is not a registered module (may be an external system).`,
              target: module.name
            });
          }
        }

        for (const api of module.apis ?? []) {
          if (api.service) {
            const serviceExists = app.getServices().some((s) => s.name === api.service);
            if (!serviceExists) {
              issues.push({
                severity: "warning",
                message: `API "${api.name}" on module "${module.name}" references service "${api.service}", which is not registered.`,
                target: `${module.name}.${api.name}`
              });
            }
          }
        }
      }

      const cycleState = new Map<string, "visiting" | "done">();

      for (const moduleName of moduleNames) {
        if (cycleState.get(moduleName) === "done") {
          continue;
        }

        const cycle = detectCycle(
          moduleName,
          moduleNames,
          (name) => app.getDependencies(name),
          cycleState,
          []
        );

        if (cycle) {
          issues.push({
            severity: "error",
            message: `Dependency cycle detected: ${cycle.join(" -> ")}.`
          });

          for (const cycleMember of cycle) {
            cycleState.set(cycleMember, "done");
          }
        }
      }

      return toValidationResult(issues);
    },

    inspectDependencies() {
      return app.getModules().map((module) => ({
        module: module.name,
        dependencies: app.getDependencies(module.name),
        dependents: app.getDependents(module.name)
      }));
    },

    checkApplicationHealth() {
      return {
        state: app.state,
        moduleCount: app.getModules().length,
        apiCount: app.getApis().length,
        serviceCount: app.getServices().length,
        architecture: this.validateArchitecture()
      };
    }
  };
}
