import { createApplication } from "@nexo-alpha/core";

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

app.addDecision({ title: "Use Redis for job coordination", status: "accepted" });
app.addConstraint({ description: "Payments must never be retried after a permanent decline." });
app.setDevelopmentState({
  currentObjective: "Implement payment recovery",
  completed: ["Retry API"],
  inProgress: ["Retry worker"],
  nextStep: "Resolve webhook ordering"
});
