import type { NexoApplication } from "@nexo-alpha/core";
import { TodoService } from "./service.js";

export function registerTodosModule(app: NexoApplication): void {
  const todoService = new TodoService();

  app.module({
    name: "todos",
    description: "Todo and Task management module",
    services: [todoService],

    apis: [
      {
        name: "getTodos",
        method: "GET",
        path: "/api/todos",
        description: "List all todos",
        handler: async () => todoService.getAll()
      },
      {
        name: "addTodo",
        method: "POST",
        path: "/api/todos",
        description: "Create a new todo",
        handler: async (request: any) => {
          const payload = (request.payload || {}) as { text?: string };
          const text = payload.text?.trim() || "New Task";
          return todoService.add(text);
        }
      },
      {
        name: "toggleTodo",
        method: "POST",
        path: "/api/todos/{id}/toggle",
        description: "Toggle todo completion status",
        handler: async (request: any) => {
          const id = Number(request.params.id);
          const item = await todoService.toggle(id);
          if (item) return item;
          return { error: "Todo not found" };
        }
      }
    ]
  });
}
