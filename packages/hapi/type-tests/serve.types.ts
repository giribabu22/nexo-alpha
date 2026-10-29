/**
 * Type tests: compiled with `tsc -p type-tests` (part of `pnpm test`).
 * A line marked @ts-expect-error fails the build if it stops being an error.
 */
import { field, model, resource, type Infer, type NexoResource } from "@nexo-alpha/core";
import { serve } from "../dist/index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function expectType<T extends true>(): T | void {}

const Task = model("tasks", { title: field.string(), done: field.boolean().default(false) });

export async function check(): Promise<void> {
  const app = await serve({
    resources: [Task, (store) => resource(Task, { store, searchable: ["title"] })],
    auth: { defaultScopes: ["tasks:read"] },
    files: { directory: "uploads" },
    cors: true
  });

  const tasks = app.resource(Task);
  expectType<Equal<typeof tasks, NexoResource<typeof Task>>>();
  const created = await tasks.create({ title: "typed" });
  expectType<Equal<typeof created, Infer<typeof Task>>>();

  // @ts-expect-error unknown field
  await tasks.create({ title: "x", priority: 1 });
  // @ts-expect-error the store comes from serve()
  await serve({ auth: { store: undefined } });
  // @ts-expect-error not a model or a module factory
  await serve({ resources: ["tasks"] });
}
