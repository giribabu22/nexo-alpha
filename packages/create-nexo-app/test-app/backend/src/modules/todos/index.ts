import type { NexoApplication } from "@nexo-alpha/core";
import type { DscInterceptor } from "@nexo-alpha/behavior";
import { TodoService } from "./service.js";

export function registerTodosModule(app: NexoApplication, interceptor?: DscInterceptor): void {
  const todoService = new TodoService();

  const instrument = <TArgs extends any[], TReturn>(
    name: string,
    fn: (...args: TArgs) => Promise<TReturn> | TReturn
  ) => (interceptor ? interceptor.instrument(name, fn) : fn);

  app.module({
    name: "todos",
    description: "Todo and Task management module",
    dependencies: ["system"],
    externalDependencies: [],
    services: [todoService],

    apis: [
      {
        name: "getTodos",
        method: "GET",
        path: "/api/todos",
        description: "List all todos",
        handler: instrument("todos.getTodos", async () => todoService.getAll())
      },
      {
        name: "addTodo",
        method: "POST",
        path: "/api/todos",
        description: "Create a new todo",
        handler: instrument("todos.addTodo", async (request: any) => {
          const payload = (request.payload || {}) as { text?: string };
          const text = payload.text?.trim() || "New Task";
          return todoService.add(text);
        })
      },
      {
        name: "toggleTodo",
        method: "POST",
        path: "/api/todos/{id}/toggle",
        description: "Toggle todo completion status",
        handler: instrument("todos.toggleTodo", async (request: any) => {
          const id = Number(request.params.id);
          const item = await todoService.toggle(id);
          if (item) return item;
          return { error: "Todo not found" };
        })
      }
    ]
  });
}

