import { createApplication } from "@nexo-alpha/core";
import { createKnowledge } from "@nexo-alpha/context";

export const app = createApplication({
  name: "fullstack-react-backend",
  version: "0.1.0",
  description: "Nexo backend service for Fullstack React app"
});

export const knowledge = createKnowledge();

knowledge.addDecision({
  title: "Fullstack Architecture",
  reason: "Separation of pure Nexo backend business logic and React frontend layer.",
  status: "accepted"
});

interface TodoItem {
  id: number;
  text: string;
  completed: boolean;
}

const todos: TodoItem[] = [
  { id: 1, text: "Explore Nexo Core Architecture", completed: true },
  { id: 2, text: "Connect React Frontend to Nexo Backend", completed: true },
  { id: 3, text: "Build your first autonomous Nexo module", completed: false }
];

app.module({
  name: "todos",
  description: "Todo and Task management module",

  apis: [
    {
      name: "getTodos",
      method: "GET",
      path: "/api/todos",
      description: "List all todos",
      handler: async () => todos
    },
    {
      name: "addTodo",
      method: "POST",
      path: "/api/todos",
      description: "Create a new todo",
      handler: async (request: any) => {
        const payload = (request.payload || {}) as { text?: string };
        const text = payload.text?.trim() || "New Task";
        const newTodo: TodoItem = {
          id: Date.now(),
          text,
          completed: false
        };
        todos.push(newTodo);
        return newTodo;
      }
    },
    {
      name: "toggleTodo",
      method: "POST",
      path: "/api/todos/{id}/toggle",
      description: "Toggle todo completion status",
      handler: async (request: any) => {
        const id = Number(request.params.id);
        const item = todos.find((t) => t.id === id);
        if (item) {
          item.completed = !item.completed;
          return item;
        }
        return { error: "Todo not found" };
      }
    }
  ]
});

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
        modules: app.getModules().map((m: { name: string }) => m.name)
      })
    }
  ]
});
