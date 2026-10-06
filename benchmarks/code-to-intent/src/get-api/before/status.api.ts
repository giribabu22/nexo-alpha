import type { NexoModule } from "@nexo-alpha/core";

export function modules(): NexoModule[] {
  return [
    {
      name: "status",
      apis: [
        {
          name: "getStatus",
          method: "GET",
          path: "/api/status",
          handler: () => ({ status: "ok" })
        }
      ]
    }
  ];
}
