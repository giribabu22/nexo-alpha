import { resource, type NexoDocumentStore, type NexoModule } from "@nexo-alpha/core";
import { Product } from "./product.model.js";

export function modules(store: NexoDocumentStore): NexoModule[] {
  return [resource(Product, { store, searchable: ["name"] })];
}
