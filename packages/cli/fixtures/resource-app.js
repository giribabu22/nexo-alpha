import { createApplication, createInMemoryDocumentStore, field, model, resource } from "@nexo-alpha/core";

export const app = createApplication({ name: "notes-app" });

const Note = model("notes", {
  title: field.string({ minLength: 1 }).describe("Short summary"),
  priority: field.enum(["low", "high"]).default("low")
});

app.module(resource(Note, { store: createInMemoryDocumentStore(), searchable: ["title"], auth: { write: ["notes:write"] } }));
