import { createApplication } from "@nexo-alpha/core";
import { createKnowledge } from "@nexo-alpha/context";

export const app = createApplication({
  name: "shop",
  version: "0.1.0",
  description: "A shop application"
});

app.module({
  name: "orders",
  description: "Order management",
  purpose: "Track customer orders",
  apis: [{ name: "createOrder", method: "POST", path: "/orders" }],
  services: [{ name: "OrderService" }]
});

app.module({
  name: "payments",
  purpose: "Handle customer payments",
  status: "in-progress",
  dependencies: ["stripe", "orders"],
  apis: [{ name: "createPayment", method: "POST", path: "/payments" }],
  services: [{ name: "PaymentService" }],
  events: ["payment.created"],
  jobs: [{ name: "retryFailedPayments", schedule: "*/5 * * * *" }]
});

export const knowledge = createKnowledge();

knowledge.addDecision({ title: "Use Redis for job coordination", status: "accepted" });
knowledge.addConstraint({ description: "Payments must never be retried after a permanent decline." });
knowledge.setDevelopmentState({
  currentObjective: "Implement payment recovery",
  completed: ["Retry API"],
  inProgress: ["Retry worker"],
  nextStep: "Resolve webhook ordering"
});
