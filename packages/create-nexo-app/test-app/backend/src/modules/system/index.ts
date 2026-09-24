import type { NexoApplication } from "@nexo-alpha/core";

export function registerSystemModule(app: NexoApplication): void {
  app.module({
    name: "system",
    description: "System health and runtime info",

    apis: [
      {
        name: "getHealth",
        method: "GET",
        path: "/api/health",
        description: "Return system and Nexo health status",
        handler: async () => ({
          status: "ok",
          framework: "Nexo",
          uptimeSeconds: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
          modules: app.getModules().map((m) => m.name)
        })
      }
    ]
  });
}
