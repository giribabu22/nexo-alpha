import type { NexoService } from "@nexo-alpha/core";

export interface TodoItem {
  id: number;
  text: string;
  completed: boolean;
  createdAt: string;
}

// Example Service: Encapsulates business logic & database/state management
export class TodoService implements NexoService {
  readonly name = "todo-service";
  readonly description = "Todo state and persistence service";

  private items: TodoItem[] = [
    { id: 1, text: "Explore Nexo Core Architecture", completed: true, createdAt: new Date().toISOString() },
    { id: 2, text: "Connect React Frontend to Nexo Backend", completed: true, createdAt: new Date().toISOString() },
    { id: 3, text: "Build your first autonomous Nexo module", completed: false, createdAt: new Date().toISOString() }
  ];

  async getAll(): Promise<TodoItem[]> {
    return [...this.items];
  }

  async add(text: string): Promise<TodoItem> {
    const newItem: TodoItem = {
      id: Date.now(),
      text,
      completed: false,
      createdAt: new Date().toISOString()
    };
    this.items.push(newItem);
    return newItem;
  }

  async toggle(id: number): Promise<TodoItem | null> {
    const item = this.items.find((t) => t.id === id);
    if (!item) return null;
    item.completed = !item.completed;
    return item;
  }
}
