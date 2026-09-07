import {
  NexoError,
  type NexoApi,
  type NexoApplication,
  type NexoJob,
  type NexoModule,
  type NexoService
} from "@nexo-alpha/core";

export type PermissionScope = "modify-source" | "modify-configuration";

export interface PermissionGrants {
  readonly scopes: ReadonlySet<PermissionScope>;
}

export interface WriteOperationResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

export interface NexoWriteInterface {
  createModule(module: NexoModule, actor?: string): WriteOperationResult<NexoModule>;
  createApi(moduleName: string, api: NexoApi, actor?: string): WriteOperationResult<NexoApi>;
  modifyApi(
    moduleName: string,
    apiName: string,
    patch: Partial<NexoApi>,
    actor?: string
  ): WriteOperationResult<NexoApi>;
  createService(
    moduleName: string,
    service: NexoService,
    actor?: string
  ): WriteOperationResult<NexoService>;
  modifyService(
    moduleName: string,
    serviceName: string,
    patch: Partial<NexoService>,
    actor?: string
  ): WriteOperationResult<NexoService>;
  createJob(moduleName: string, job: NexoJob, actor?: string): WriteOperationResult<NexoJob>;
  modifyJob(
    moduleName: string,
    jobName: string,
    patch: Partial<NexoJob>,
    actor?: string
  ): WriteOperationResult<NexoJob>;
  updateConfiguration(
    patch: Record<string, unknown>,
    actor?: string
  ): WriteOperationResult<Readonly<Record<string, unknown>>>;
  addDependency(
    moduleName: string,
    dependencyName: string,
    actor?: string
  ): WriteOperationResult<readonly string[]>;
}

function hasPermission(grants: PermissionGrants, scope: PermissionScope): boolean {
  return grants.scopes.has(scope);
}

function historyEntry(
  operation: string,
  target: string | undefined,
  actor: string | undefined,
  result: "success" | "denied" | "failed",
  detail?: string
): {
  operation: string;
  target?: string;
  actor?: string;
  result: "success" | "denied" | "failed";
  detail?: string;
} {
  return {
    operation,
    result,
    ...(target !== undefined ? { target } : {}),
    ...(actor !== undefined ? { actor } : {}),
    ...(detail !== undefined ? { detail } : {})
  };
}

export function createWriteInterface(
  app: NexoApplication,
  grants: PermissionGrants
): NexoWriteInterface {
  function denied<T>(
    operation: string,
    target: string | undefined,
    scope: PermissionScope,
    actor: string | undefined
  ): WriteOperationResult<T> {
    const error = `Permission required: "${scope}" is not granted for operation "${operation}".`;

    app.addHistoryEntry(historyEntry(operation, target, actor, "denied", error));

    return { success: false, error };
  }

  function failed<T>(
    operation: string,
    target: string | undefined,
    actor: string | undefined,
    error: string
  ): WriteOperationResult<T> {
    app.addHistoryEntry(historyEntry(operation, target, actor, "failed", error));

    return { success: false, error };
  }

  function succeeded<T>(
    operation: string,
    target: string | undefined,
    actor: string | undefined,
    data: T
  ): WriteOperationResult<T> {
    app.addHistoryEntry(historyEntry(operation, target, actor, "success"));

    return { success: true, data };
  }

  return {
    createModule(module, actor) {
      const operation = "create_module";

      if (!hasPermission(grants, "modify-source")) {
        return denied(operation, module.name, "modify-source", actor);
      }

      if (app.getModule(module.name)) {
        return failed(
          operation,
          module.name,
          actor,
          `Nexo module "${module.name}" is already registered.`
        );
      }

      try {
        app.module(module);
        return succeeded(operation, module.name, actor, module);
      } catch (error) {
        if (error instanceof NexoError) {
          return failed(operation, module.name, actor, error.message);
        }
        throw error;
      }
    },

    createApi(moduleName, api, actor) {
      const operation = "create_api";
      const target = `${moduleName}.${api.name}`;

      if (!hasPermission(grants, "modify-source")) {
        return denied(operation, target, "modify-source", actor);
      }

      if (!app.getModule(moduleName)) {
        return failed(operation, target, actor, `Nexo module "${moduleName}" is not registered.`);
      }

      try {
        app.addApiToModule(moduleName, api);
        return succeeded(operation, target, actor, api);
      } catch (error) {
        if (error instanceof NexoError) {
          return failed(operation, target, actor, error.message);
        }
        throw error;
      }
    },

    modifyApi(moduleName, apiName, patch, actor) {
      const operation = "modify_api";
      const target = `${moduleName}.${apiName}`;

      if (!hasPermission(grants, "modify-source")) {
        return denied(operation, target, "modify-source", actor);
      }

      try {
        const updated = app.updateApi(moduleName, apiName, patch);
        return succeeded(operation, target, actor, updated);
      } catch (error) {
        if (error instanceof NexoError) {
          return failed(operation, target, actor, error.message);
        }
        throw error;
      }
    },

    createService(moduleName, service, actor) {
      const operation = "create_service";
      const target = `${moduleName}.${service.name}`;

      if (!hasPermission(grants, "modify-source")) {
        return denied(operation, target, "modify-source", actor);
      }

      try {
        app.addServiceToModule(moduleName, service);
        return succeeded(operation, target, actor, service);
      } catch (error) {
        if (error instanceof NexoError) {
          return failed(operation, target, actor, error.message);
        }
        throw error;
      }
    },

    modifyService(moduleName, serviceName, patch, actor) {
      const operation = "modify_service";
      const target = `${moduleName}.${serviceName}`;

      if (!hasPermission(grants, "modify-source")) {
        return denied(operation, target, "modify-source", actor);
      }

      try {
        const updated = app.updateService(moduleName, serviceName, patch);
        return succeeded(operation, target, actor, updated);
      } catch (error) {
        if (error instanceof NexoError) {
          return failed(operation, target, actor, error.message);
        }
        throw error;
      }
    },

    createJob(moduleName, job, actor) {
      const operation = "create_job";
      const target = `${moduleName}.${job.name}`;

      if (!hasPermission(grants, "modify-source")) {
        return denied(operation, target, "modify-source", actor);
      }

      try {
        app.addJobToModule(moduleName, job);
        return succeeded(operation, target, actor, job);
      } catch (error) {
        if (error instanceof NexoError) {
          return failed(operation, target, actor, error.message);
        }
        throw error;
      }
    },

    modifyJob(moduleName, jobName, patch, actor) {
      const operation = "modify_job";
      const target = `${moduleName}.${jobName}`;

      if (!hasPermission(grants, "modify-source")) {
        return denied(operation, target, "modify-source", actor);
      }

      try {
        const updated = app.updateJob(moduleName, jobName, patch);
        return succeeded(operation, target, actor, updated);
      } catch (error) {
        if (error instanceof NexoError) {
          return failed(operation, target, actor, error.message);
        }
        throw error;
      }
    },

    updateConfiguration(patch, actor) {
      const operation = "update_configuration";

      if (!hasPermission(grants, "modify-configuration")) {
        return denied(operation, undefined, "modify-configuration", actor);
      }

      const config = app.updateConfig(patch);
      return succeeded(operation, undefined, actor, config);
    },

    addDependency(moduleName, dependencyName, actor) {
      const operation = "add_dependency";
      const target = `${moduleName} -> ${dependencyName}`;

      if (!hasPermission(grants, "modify-source")) {
        return denied(operation, target, "modify-source", actor);
      }

      try {
        const dependencies = app.addModuleDependency(moduleName, dependencyName);
        return succeeded(operation, target, actor, dependencies);
      } catch (error) {
        if (error instanceof NexoError) {
          return failed(operation, target, actor, error.message);
        }
        throw error;
      }
    }
  };
}
