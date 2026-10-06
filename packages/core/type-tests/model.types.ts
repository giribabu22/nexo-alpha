/**
 * Type tests: compiled with `tsc -p type-tests` (part of `pnpm test`).
 * A line marked @ts-expect-error fails the build if it stops being an error.
 */
import {
  field,
  model,
  resource,
  createInMemoryDocumentStore,
  NexoHttpError,
  type Infer,
  type InferInput,
  type InferPatch,
  type ResourceListQuery
} from "../dist/index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function expectType<T extends true>(): T | void {}

const User = model("users", {
  name: field.string(),
  role: field.enum(["member", "admin"]).default("member"),
  age: field.number().optional(),
  tags: field.array(field.string()).default([]),
  teamId: field.ref("teams").optional()
});
type User = Infer<typeof User>;

expectType<Equal<User, {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  name: string;
  role: "member" | "admin";
  tags: string[];
  age?: number;
  teamId?: string;
}>>();

expectType<Equal<InferInput<typeof User>, {
  name: string;
  role?: "member" | "admin" | undefined;
  age?: number | undefined;
  tags?: string[] | undefined;
  teamId?: string | undefined;
}>>();

expectType<Equal<InferPatch<typeof User>["age"], number | null | undefined>>();
expectType<Equal<InferPatch<typeof User>["name"], string | undefined>>();

const users = resource(User, { store: createInMemoryDocumentStore(), searchable: ["name"] });

async function usage(): Promise<void> {
  const ann = await users.create({ name: "Ann" });
  expectType<Equal<typeof ann, User>>();
  const page = await users.list({ where: { role: "admin" }, sort: "-createdAt" });
  expectType<Equal<typeof page.items, User[]>>();
  await users.update(ann.id, { age: null });

  // @ts-expect-error name is required
  await users.create({ role: "admin" });
  // @ts-expect-error not a role
  await users.create({ name: "Bo", role: "owner" });
  // @ts-expect-error not a field
  await users.create({ name: "Bo", emial: "x" });
  // @ts-expect-error required fields cannot be cleared
  await users.update(ann.id, { name: null });
  // @ts-expect-error filter value must match the field type
  await users.list({ where: { role: "owner" } });
  // @ts-expect-error can only sort by a field
  await users.list({ sort: "-password" });
}

// @ts-expect-error searchable must name fields of the model
resource(User, { store: createInMemoryDocumentStore(), searchable: ["email"] });

const query: ResourceListQuery<typeof User> = { limit: 10, search: "a" };
void query;
void usage;

// The ownership example from docs/primitives.md#resource.
const Note = model("notes", { text: field.text(), owner: field.string().optional() });
resource(Note, {
  store: createInMemoryDocumentStore(),
  auth: { read: ["notes:read"], write: ["notes:write"] },
  beforeWrite: (note, { operation, existing, request }) => {
    const user = (request?.auth?.identity as { sub?: string } | undefined)?.sub;
    if (operation === "update" && existing?.owner !== user) throw new NexoHttpError(403, "FORBIDDEN", "Not your note.");
    return operation === "create" && user ? { ...note, owner: user } : note;
  }
});
