import {
  createApplication
} from "@nexo-alpha/core";

export const app = createApplication({
  name: "hello-world",
  version: "0.1.0",
  description: "My first Nexo application"
});

app.module({
  name: "hello",
  description: "Hello World module",

  apis: [
    {
      name: "sayHello",
      method: "GET",
      path: "/hello",
      description: "Returns a greeting",
      handler: async () => ({ message: "Hello from Nexo" })
    }
  ],

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
