import { createApplication, createSqliteDocumentStore, resource } from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";
import { Task } from "../task.model.js";

export async function start(): Promise<{ url: string; stop(): Promise<void> }> {
  const store = await createSqliteDocumentStore("data/app.db");
  const app = createApplication({ name: "tasks" });
  app.module(resource(Task, { store }));

  await app.start();
  const server = await startHapiServer(app, { port: Number(process.env.PORT ?? 3000) });
  console.log(`tasks ready at ${server.info.uri}`);

  const stop = async (): Promise<void> => {
    await server.stop({ timeout: 5000 });
    await app.stop();
    await store.close();
  };
  const shutdown = (): void => {
    stop().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error("Error during shutdown:", error);
        process.exit(1);
      }
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return { url: server.info.uri, stop };
}
