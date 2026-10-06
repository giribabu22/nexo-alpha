import { httpResponse, type NexoDocumentStore, type NexoModule } from "@nexo-alpha/core";
import { randomUUID } from "node:crypto";
import { createProductSchema, type Product, type ProductInput, type ProductPage } from "./product.js";

const integer = { type: "string", pattern: "^\\d+$" } as const;

export function modules(store: NexoDocumentStore): NexoModule[] {
  return [
    {
      name: "products",
      apis: [
        {
          name: "listProducts",
          method: "GET",
          path: "/api/products",
          schema: {
            query: {
              search: { type: "string" },
              category: { type: "string", enum: ["tools", "toys", "books"] },
              limit: integer,
              offset: integer
            }
          },
          handler: async (context): Promise<ProductPage> => {
            const query = context.query as { search?: string; category?: string; limit?: string; offset?: string };
            const limit = Math.min(Number(query.limit ?? 50), 200);
            const offset = Number(query.offset ?? 0);
            const search = query.search?.toLowerCase();
            const matches = (await store.list<Product>("products")).filter(
              (product) =>
                (search === undefined || product.name.toLowerCase().includes(search)) &&
                (query.category === undefined || product.category === query.category)
            );
            return { items: matches.slice(offset, offset + limit), total: matches.length, limit, offset };
          }
        },
        {
          name: "createProduct",
          method: "POST",
          path: "/api/products",
          schema: { body: createProductSchema },
          handler: async (context) => {
            const input = context.payload as ProductInput;
            const now = new Date().toISOString();
            const product: Product = {
              id: randomUUID(),
              name: input.name,
              price: input.price,
              category: input.category,
              createdAt: now,
              updatedAt: now
            };
            await store.put("products", product.id, product);
            return httpResponse(201, product);
          }
        }
      ]
    }
  ];
}
