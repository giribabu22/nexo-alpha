import type { NexoFieldSchema } from "@nexo-alpha/core";

export interface Product {
  id: string;
  name: string;
  price: number;
  category: "tools" | "toys" | "books";
  createdAt: string;
  updatedAt: string;
}

export type ProductInput = Pick<Product, "name" | "price" | "category">;

export interface ProductPage {
  items: Product[];
  total: number;
  limit: number;
  offset: number;
}

export const createProductSchema: NexoFieldSchema = {
  type: "object",
  required: ["name", "price", "category"],
  properties: {
    name: { type: "string", minLength: 1 },
    price: { type: "number", min: 0 },
    category: { type: "string", enum: ["tools", "toys", "books"] }
  }
};
