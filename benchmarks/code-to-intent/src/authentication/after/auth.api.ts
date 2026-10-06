import { createAuth, type NexoAuthenticator, type NexoDocumentStore, type NexoModule } from "@nexo-alpha/core";

export function setup(store: NexoDocumentStore, secret: string): { modules: NexoModule[]; authenticate: NexoAuthenticator } {
  const auth = createAuth({ store, secret });
  return { modules: [auth], authenticate: auth.authenticate };
}
