import { serve } from "@nexo-alpha/hapi";
import { Task } from "../task.model.js";

export async function start(): Promise<{ url: string; stop(): Promise<void> }> {
  const app = await serve({ name: "tasks", resources: [Task] });
  return { url: app.url, stop: app.stop };
}
