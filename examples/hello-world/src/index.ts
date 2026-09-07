import { app } from "./app.js";

await app.start();

console.log({
  name: app.name,
  version: app.version,
  state: app.state,
  modules: app.getModules().map((module) => module.name)
});
