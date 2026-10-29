import { app } from "./app.js";
import { serve } from "@nexo-alpha/hapi";

// Starts the application and serves it on $PORT or 3000; Ctrl+C stops cleanly.
const { url } = await serve({ app });

console.log({
  name: app.name,
  version: app.version,
  state: app.state,
  modules: app.getModules().map((module) => module.name),
  uri: url
});
