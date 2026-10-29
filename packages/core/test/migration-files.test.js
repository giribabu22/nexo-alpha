/**
 * Migrations, step 4 (docs/architecture/migrations-design.md §6, §13): a
 * migration that deletes a record, or stops mentioning one of its files,
 * releases that file in the same batch. Contents are removed only later, by
 * the existing cleanup, and only if no record took the file back.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createFileDocumentStore,
  createFiles,
  createInMemoryBlobStore,
  createInMemoryDocumentStore,
  createSqliteDocumentStore,
  field,
  migration,
  model,
  planMigrations,
  resource,
  runInProject,
  runMigrations,
  scopeByProject,
  MIGRATIONS_COLLECTION
} from "../dist/index.js";

const HAS_SQLITE = await import("node:sqlite").then(() => true, () => false);
const quiet = { onWarning: () => undefined, backup: false };
const DELAY = 60_000;

const BACKENDS = [
  { name: "Memory", open: async () => createInMemoryDocumentStore() },
  { name: "File", open: async (dir) => createFileDocumentStore(join(dir, "app.json")) },
  { name: "Sqlite", open: async (dir) => createSqliteDocumentStore(join(dir, "app.db")), skip: !HAS_SQLITE && "node:sqlite not available" }
];

const Profile = model("profiles", { name: field.string(), photo: field.file().optional() });
const png = (n) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, n]);

/** A store with two profiles, each owning an uploaded photo. */
async function withProfiles(backend, fn) {
  const dir = await mkdtemp(join(tmpdir(), "nexo-migration-files-"));
  const store = await backend.open(dir);
  const blobs = createInMemoryBlobStore();
  const files = createFiles({ store, blobs, cleanup: { removeDetachedAfterMs: DELAY } });
  const profiles = resource(Profile, { store });
  const annPhoto = await files.upload(png(1), { name: "ann.png", type: "image/png" });
  const boPhoto = await files.upload(png(2), { name: "bo.png", type: "image/png" });
  const ann = await profiles.create({ name: "Ann", photo: annPhoto.id });
  const bo = await profiles.create({ name: "Bo", photo: boPhoto.id });
  try {
    await fn({ store, blobs, files, profiles, ann, bo, annPhoto, boPhoto });
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const dropAnn = migration({ id: "20261029T0700-drop-ann", up: (m) => m.update("profiles", (p) => (p.name === "Ann" ? m.remove : p)) });

for (const backend of BACKENDS) {
  const name = (title) => `migration files (${backend.name}): ${title}`;

  test(name("deleting a record releases its file in the same batch; the contents go only when cleanup runs after its delay"), { skip: backend.skip }, () =>
    withProfiles(backend, async ({ store, blobs, files, annPhoto, boPhoto }) => {
      const [applied] = (await runMigrations(store, [dropAnn], quiet)).applied;
      assert.equal(applied.filesReleased, 1);
      assert.equal((await store.get(MIGRATIONS_COLLECTION, dropAnn.id)).filesReleased, 1);

      const released = await store.get("files", annPhoto.id);
      assert.equal(released.attachedTo, undefined);
      assert.ok(Date.parse(released.detachedAt) > 0);
      assert.equal((await store.get("files", boPhoto.id)).attachedTo, `profiles/${(await store.entries("profiles"))[0][0]}`, "Bo's file is untouched");
      assert.ok(await blobs.get(annPhoto.id), "the contents are still there right after the migration");

      assert.deepEqual(await files.sweep(Date.now()), [], "nothing is removed before the delay");
      assert.deepEqual(await files.sweep(Date.now() + DELAY + 1000), [annPhoto.id]);
      assert.equal(await blobs.get(annPhoto.id), undefined);
      assert.ok(await blobs.get(boPhoto.id));
    })
  );

  test(name("a record that stops mentioning its file releases it; a renamed field keeps it"), { skip: backend.skip }, () =>
    withProfiles(backend, async ({ store, annPhoto, boPhoto }) => {
      const rename = migration({ id: "20261029T0700-photo-to-avatar", up: (m) => m.renameField("profiles", "photo", "avatar") });
      assert.equal((await runMigrations(store, [rename], quiet)).applied[0].filesReleased, 0, "the id moved to avatar; still in use");
      assert.ok((await store.get("files", annPhoto.id)).attachedTo);

      const drop = migration({ id: "20261029T0710-drop-avatars", up: (m) => m.removeField("profiles", "avatar") });
      assert.equal((await runMigrations(store, [rename, drop], quiet)).applied[0].filesReleased, 2);
      assert.equal((await store.get("files", annPhoto.id)).attachedTo, undefined);
      assert.equal((await store.get("files", boPhoto.id)).attachedTo, undefined);
    })
  );

  test(name("plan lists the files a migration would release, and releases nothing"), { skip: backend.skip }, () =>
    withProfiles(backend, async ({ store, ann, annPhoto }) => {
      const [plan] = (await planMigrations(store, [dropAnn], quiet)).plans;
      assert.deepEqual(plan.filesReleased, [{ collection: "files", id: annPhoto.id, owner: `profiles/${ann.id}`, name: "ann.png" }]);
      assert.equal(plan.writes.length, 1, "file releases aren't counted as document changes");
      assert.equal((await store.get("files", annPhoto.id)).attachedTo, `profiles/${ann.id}`);
    })
  );

  test(name("a migration that fails after its releases were computed releases nothing, and every content stays"), { skip: backend.skip }, () =>
    withProfiles(backend, async ({ store, blobs, files, ann, annPhoto }) => {
      const failing = { ...store, writeBatch: async () => { throw new Error("disk full"); } };
      await assert.rejects(runMigrations(failing, [dropAnn], quiet), /disk full/);
      assert.equal((await store.get("files", annPhoto.id)).attachedTo, `profiles/${ann.id}`);
      assert.deepEqual(await files.sweep(Date.now() + 10 * DELAY), []);
      assert.ok(await blobs.get(annPhoto.id));
    })
  );

  test(name("a file a record takes back before cleanup runs isn't removed"), { skip: backend.skip }, () =>
    withProfiles(backend, async ({ store, blobs, files, profiles, annPhoto }) => {
      await runMigrations(store, [dropAnn], quiet);
      const again = await profiles.create({ name: "Ann again", photo: annPhoto.id });
      assert.equal((await store.get("files", annPhoto.id)).attachedTo, `profiles/${again.id}`);
      assert.deepEqual(await files.sweep(Date.now() + 10 * DELAY), []);
      assert.ok(await blobs.get(annPhoto.id));
    })
  );

  test(name("perProject: each project's files are released in that project"), { skip: backend.skip }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "nexo-migration-files-"));
    const store = await backend.open(dir);
    try {
      const scoped = scopeByProject(store);
      const files = createFiles({ store: scoped, blobs: createInMemoryBlobStore() });
      const profiles = resource(Profile, { store: scoped });
      for (const project of ["acme", "globex"]) {
        await store.put("nexo_projects", project, { id: project });
        await runInProject(project, async () => {
          const photo = await files.upload(png(3), { name: `${project}.png`, type: "image/png" });
          await profiles.create({ name: "Ann", photo: photo.id });
        });
      }
      const dropPerProject = migration({ ...dropAnn, id: "20261029T0700-drop-ann-everywhere", perProject: true });
      const [applied] = (await runMigrations(store, [dropPerProject], quiet)).applied;
      assert.equal(applied.filesReleased, 2);
      for (const project of ["acme", "globex"]) {
        const [[, file]] = await store.entries(`${project}::files`);
        assert.equal(file.attachedTo, undefined, project);
        assert.ok(file.detachedAt);
      }
    } finally {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}
