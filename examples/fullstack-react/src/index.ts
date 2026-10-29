import { app, scheduler, jobQueue } from "./app.js";
import { serve } from "@nexo-alpha/hapi";

// Starts the application and serves it on $PORT or 4000; Ctrl+C stops cleanly.
const { url } = await serve({ app, port: Number(process.env.PORT) || 4000 });
scheduler.start();
await jobQueue.start();

console.log({
  name: app.name,
  version: app.version,
  state: app.state,
  modules: app.getModules().map((m: { name: string }) => m.name),
  uri: url,
  studio: `${url}/studio`
});
