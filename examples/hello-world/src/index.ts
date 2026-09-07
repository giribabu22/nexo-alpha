import {
  createApplication
} from "@nexo-alpha/core";

const app = createApplication({
  name: "hello-world",
  version: "0.1.0",
  description: "My first Nexo application"
});

app.module({
  name: "hello",
  description: "Hello World module",

  initialize() {
    console.log("Hello module initialized");
  },

  start() {
    console.log("Hello module started");
  },

  stop() {
    console.log("Hello module stopped");
  }
});

await app.start();

console.log({
  name: app.name,
  version: app.version,
  state: app.state,
  modules: app.getModules().map((module) => module.name)
});
