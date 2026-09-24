import type { NexoApplication } from "@nexo-alpha/core";
import type { ApplicationKnowledge } from "@nexo-alpha/context";
import type { DscInterceptor } from "@nexo-alpha/behavior";

export function registerSystemModule(
  app: NexoApplication,
  knowledge?: ApplicationKnowledge,
  interceptor?: DscInterceptor
): void {
  const instrument = <TArgs extends any[], TReturn>(
    name: string,
    fn: (...args: TArgs) => Promise<TReturn> | TReturn
  ) => (interceptor ? interceptor.instrument(name, fn) : fn);

  app.module({
    name: "system",
    description: "System health, runtime info, and DSC optimization metrics",

    apis: [
      {
        name: "getHealth",
        method: "GET",
        path: "/api/health",
        description: "Return system and Nexo health status",
        handler: instrument("system.getHealth", async () => ({
          status: "ok",
          framework: "Nexo",
          uptimeSeconds: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
          modules: app.getModules().map((m) => m.name),
          moduleGraph: app.getModules().map((m) => ({
            name: m.name,
            description: m.description,
            dependencies: app.getDependencies(m.name),
            dependents: app.getDependents(m.name),
            externalDependencies: m.externalDependencies ?? []
          }))
        }))
      },
      {
        name: "getKnowledge",
        method: "GET",
        path: "/api/knowledge",
        description: "Return architecture decisions, constraints, and component intents",
        handler: instrument("system.getKnowledge", async () => ({
          decisions: knowledge?.getDecisions() ?? [],
          constraints: knowledge?.getConstraints() ?? [],
          intents: knowledge?.getIntents() ?? [],
          developmentState: knowledge?.getDevelopmentState() ?? null
        }))
      },
      {
        name: "getDscMetrics",
        method: "GET",
        path: "/api/dsc/metrics",
        description: "Return live DSC execution and optimization metrics",
        handler: async () => ({
          metrics: interceptor?.getCollector().getMetrics() ?? null,
          recentRecords: interceptor?.getCollector().getRecords().slice(-20) ?? []
        })
      }
    ]
  });
}

