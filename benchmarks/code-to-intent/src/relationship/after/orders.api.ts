import { field, model, resource, type NexoDocumentStore, type NexoModule } from "@nexo-alpha/core";

export const Customer = model("customers", {
  name: field.string({ minLength: 1 })
});

export const Order = model("orders", {
  customerId: field.ref("customers"),
  total: field.number({ min: 0 })
});

export function modules(store: NexoDocumentStore): NexoModule[] {
  return [resource(Customer, { store }), resource(Order, { store })];
}
