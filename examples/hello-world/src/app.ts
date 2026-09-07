import {
  createApplication
} from "@nexo-alpha/core";
import { createKnowledge } from "@nexo-alpha/context";

export const app = createApplication({
  name: "hello-world",
  version: "0.1.0",
  description: "My first Nexo application"
});

export const knowledge = createKnowledge();

knowledge.addDecision({
  title: "Use Hapi as the HTTP adapter",
  reason: "Hapi is named as the HTTP foundation in the Nexo PRD.",
  status: "accepted"
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
