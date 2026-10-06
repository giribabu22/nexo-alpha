import { NexoHttpError, httpResponse, type NexoDocumentStore, type NexoModule } from "@nexo-alpha/core";
import { randomUUID } from "node:crypto";

export interface Customer {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  customerId: string;
  total: number;
  createdAt: string;
  updatedAt: string;
}

function stamp(): { id: string; createdAt: string; updatedAt: string } {
  const now = new Date().toISOString();
  return { id: randomUUID(), createdAt: now, updatedAt: now };
}

export function modules(store: NexoDocumentStore): NexoModule[] {
  return [
    {
      name: "customers",
      apis: [
        {
          name: "createCustomer",
          method: "POST",
          path: "/api/customers",
          schema: { body: { type: "object", required: ["name"], properties: { name: { type: "string", minLength: 1 } } } },
          handler: async (context) => {
            const customer: Customer = { ...stamp(), name: (context.payload as { name: string }).name };
            await store.put("customers", customer.id, customer);
            return httpResponse(201, customer);
          }
        }
      ]
    },
    {
      name: "orders",
      dependencies: ["customers"],
      apis: [
        {
          name: "listOrders",
          method: "GET",
          path: "/api/orders",
          schema: { query: { customerId: { type: "string" } } },
          handler: async (context) => {
            const customerId = context.query.customerId as string | undefined;
            const orders = await store.list<Order>("orders");
            return orders.filter((order) => customerId === undefined || order.customerId === customerId);
          }
        },
        {
          name: "createOrder",
          method: "POST",
          path: "/api/orders",
          schema: {
            body: {
              type: "object",
              required: ["customerId", "total"],
              properties: { customerId: { type: "string", minLength: 1 }, total: { type: "number", min: 0 } }
            }
          },
          handler: async (context) => {
            const input = context.payload as { customerId: string; total: number };
            if ((await store.get("customers", input.customerId)) === undefined) {
              throw new NexoHttpError(400, "UNKNOWN_CUSTOMER", `Customer "${input.customerId}" does not exist.`);
            }
            const order: Order = { ...stamp(), customerId: input.customerId, total: input.total };
            await store.put("orders", order.id, order);
            return httpResponse(201, order);
          }
        }
      ]
    }
  ];
}
