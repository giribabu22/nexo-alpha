import { api, type NexoModule } from "@nexo-alpha/core";

export function modules(): NexoModule[] {
  return [
    {
      name: "status",
      apis: [api.get("/api/status", () => ({ status: "ok" }))]
    }
  ];
}
