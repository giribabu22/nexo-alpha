/** Type tests: compiled with `tsc -p type-tests` (part of `pnpm test`). */
import type { Infer as CoreInfer, NexoResource as CoreResource } from "@nexo-alpha/core";
import { field, model, resource, createInMemoryDocumentStore, type Infer } from "../dist/index.js";
import { model as browserModel, field as browserField } from "../dist/model.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function expectType<T extends true>(): T | void {}

const Note = model("notes", { text: field.string(), pinned: field.boolean().default(false) });
expectType<Equal<Infer<typeof Note>, CoreInfer<typeof Note>>>();
expectType<Equal<Infer<typeof Note>["pinned"], boolean>>();

// A data-package resource is a core resource.
const notes: CoreResource<typeof Note> = resource(Note, { store: createInMemoryDocumentStore() });
void notes;

// The browser entry builds the same models.
const Same = browserModel("notes", { text: browserField.string(), pinned: browserField.boolean().default(false) });
expectType<Equal<Infer<typeof Same>, Infer<typeof Note>>>();

// @ts-expect-error unknown field
void resource(Note, { store: createInMemoryDocumentStore(), searchable: ["title"] });
