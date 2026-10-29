/** Type tests: compiled with `tsc -p type-tests` (part of `pnpm test`). */
import React from "react";
import { field, model, type Infer } from "@nexo-alpha/core/model";
import {
  createNexoClient,
  useRecord,
  useResource,
  NexoForm,
  NexoResourceTable,
  page,
  type NexoPageRouteProps
} from "../dist/index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function expectType<T extends true>(): T | void {}

const Task = model("tasks", {
  title: field.string(),
  done: field.boolean().default(false),
  due: field.date().optional()
});
type Task = Infer<typeof Task>;

async function client(): Promise<void> {
  const tasks = createNexoClient().resource(Task);
  const page1 = await tasks.list({ where: { done: false }, sort: "-due" });
  expectType<Equal<typeof page1.items, Task[]>>();
  const created = await tasks.create({ title: "Ship" });
  expectType<Equal<typeof created, Task>>();
  await tasks.update(created.id, { due: null });
  // @ts-expect-error title is required
  await tasks.create({ done: true });
  // @ts-expect-error unknown field
  await tasks.update(created.id, { titel: "typo" });

  const api = createNexoClient().resources({ tasks: Task });
  const listed = await api.tasks.list();
  expectType<Equal<typeof listed.items, Task[]>>();
  // @ts-expect-error title is required
  await api.tasks.create({ done: true });
  // @ts-expect-error only the models passed in
  void api.users;
  // @ts-expect-error models, not resource definitions
  createNexoClient().resources({ tasks: { path: "/tasks" } });
}

function TasksPage(_props: NexoPageRouteProps): React.JSX.Element {
  const tasks = useResource(Task, { where: { done: false } });
  expectType<Equal<typeof tasks.items, readonly Task[]>>();
  const one = useRecord(Task, "t1");
  expectType<Equal<typeof one.data, Task | null>>();
  return (
    <>
      <NexoForm model={Task} fields={["title", "due"]} onSubmit={tasks.create} />
      {/* @ts-expect-error not a field of the model */}
      <NexoForm model={Task} fields={["owner"]} />
      <NexoResourceTable model={Task} columns={["title", "done", "createdAt"]} sort="-createdAt" allowDelete />
      {/* @ts-expect-error not a column of the model */}
      <NexoResourceTable model={Task} columns={["owner"]} />
    </>
  );
}

page("/tasks", TasksPage);
void client;
