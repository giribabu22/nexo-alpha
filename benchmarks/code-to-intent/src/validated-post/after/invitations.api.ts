import { field, model, resource, type NexoDocumentStore, type NexoModule } from "@nexo-alpha/core";

export const Invitation = model("invitations", {
  email: field.email(),
  role: field.enum(["member", "admin"]).default("member")
});

export function modules(store: NexoDocumentStore): NexoModule[] {
  return [resource(Invitation, { store, expose: ["create"], auth: { write: ["invites:write"] } })];
}
