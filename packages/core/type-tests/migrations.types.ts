/**
 * Type tests: compiled with `tsc -p type-tests` (part of `pnpm test`).
 * A line marked @ts-expect-error fails the build if it stops being an error.
 */
import { migration, migrationStatus, createInMemoryDocumentStore, type MigrationDocument, type NexoMigration } from "../dist/index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function expectType<T extends true>(): T | void {}

const rename: NexoMigration = migration({
  id: "20261029T0730-rename-user-name",
  description: "users: name → fullName",
  up: (m) => m.renameField("users", "name", "fullName"),
  async down(m) {
    await m.renameField("users", "fullName", "name");
  }
});

migration({
  id: "20261029T0800-drop-archived",
  async up(m) {
    await m.update("notes", (note) => {
      expectType<Equal<typeof note.id, string>>();
      return note.archived === true ? m.remove : { ...note, title: String(note.title).trim() };
    });
    await m.setField("users", "role", (user: MigrationDocument) => (user.admin === true ? "admin" : "member"));
    await m.insert("settings", { theme: "light" });
    const users = await m.list("users");
    expectType<Equal<typeof users, MigrationDocument[]>>();
  }
});

// @ts-expect-error up is required
migration({ id: "20261029T0900-nothing" });
// @ts-expect-error update callbacks return a document or m.remove
migration({ id: "20261029T0901-bad", up: (m) => m.update("notes", () => "deleted") });

export async function status(): Promise<void> {
  const report = await migrationStatus(createInMemoryDocumentStore(), [rename]);
  expectType<Equal<typeof report.pending, readonly NexoMigration[]>>();
}
