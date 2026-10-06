import { resource, type NexoDocumentStore, type NexoModule } from "@nexo-alpha/core";
import { User } from "./user.model.js";

export function modules(store: NexoDocumentStore): NexoModule[] {
  return [resource(User, { store })];
}
