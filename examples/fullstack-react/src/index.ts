import { app } from "./app.js";
import { startHapiServer } from "@nexo-alpha/hapi";

await app.start();

const PORT = Number(process.env.PORT) || 4000;
const server = await startHapiServer(app, {
  port: PORT
});

console.log({
  name: app.name,
  version: app.version,
  state: app.state,
  modules: app.getModules().map((m: { name: string }) => m.name),
  uri: server.info.uri
});
