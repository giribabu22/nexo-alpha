/**
 * writeBatch: every write or none, on each built-in store, including when a
 * write fails halfway (a SQLite trigger, a failed file rename). Migrations
 * rely on this (docs/architecture/migrations-design.md §5).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fsPromises, { mkdtemp, readFile, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileDocumentStore, createInMemoryDocumentStore, createSqliteDocumentStore, scopeByProject, runInProject } from "../dist/index.js";

const HAS_SQLITE = await import("node:sqlite").then(() => true, () => false);

const BACKENDS = [
  { name: "Memory", open: async () => createInMemoryDocumentStore() },
  { name: "File", open: async (dir) => createFileDocumentStore(join(dir, "app.json")) },
  { name: "Sqlite", open: async (dir) => createSqliteDocumentStore(join(dir, "app.db")), skip: !HAS_SQLITE && "node:sqlite not available" }
];

async function withStore(backend, fn) {
  const dir = await mkdtemp(join(tmpdir(), "nexo-batch-"));
  const store = await backend.open(dir);
  try {
    await store.put("notes", "a", { id: "a", text: "A" });
    await store.put("notes", "b", { id: "b", text: "B" });
    await store.put("emails", "ann@example.com", { userId: "u1" }); // no id inside
    await fn(store, dir);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const snapshot = async (store) => ({ notes: await store.entries("notes"), emails: await store.entries("emails"), other: await store.entries("other") });

for (const backend of BACKENDS) {
  const name = (title) => `writeBatch (${backend.name}): ${title}`;

  test(name("entries() lists documents with their ids, including ones without an id inside"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      assert.deepEqual(await store.entries("notes"), [["a", { id: "a", text: "A" }], ["b", { id: "b", text: "B" }]]);
      assert.deepEqual(await store.entries("emails"), [["ann@example.com", { userId: "u1" }]]);
      assert.deepEqual(await store.entries("none"), []);
    })
  );

  test(name("updates, inserts and deletes apply together when every expectation holds"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      const ok = await store.writeBatch([
        { collection: "notes", id: "a", expected: { id: "a", text: "A" }, next: { id: "a", text: "A2" } },
        { collection: "notes", id: "b", expected: { id: "b", text: "B" }, next: undefined },
        { collection: "other", id: "c", expected: undefined, next: { id: "c" } }
      ]);
      assert.equal(ok, true);
      assert.deepEqual(await snapshot(store), {
        notes: [["a", { id: "a", text: "A2" }]],
        emails: [["ann@example.com", { userId: "u1" }]],
        other: [["c", { id: "c" }]]
      });
    })
  );

  test(name("one stale expectation: false, and nothing written"), { skip: backend.skip }, async () => {
    for (const stale of [
      { collection: "notes", id: "b", expected: { id: "b", text: "changed meanwhile" }, next: { id: "b", text: "B2" } },
      { collection: "notes", id: "a", expected: undefined, next: { id: "a" } }, // expected absent, but it exists
      { collection: "notes", id: "gone", expected: { id: "gone" }, next: undefined } // expected present, but it doesn't
    ]) {
      await withStore(backend, async (store) => {
        const before = await snapshot(store);
        // The stale write comes first, so it wins over the good write to the same id.
        const ok = await store.writeBatch([
          stale,
          { collection: "other", id: "c", expected: undefined, next: { id: "c" } },
          { collection: "notes", id: "a", expected: { id: "a", text: "A" }, next: { id: "a", text: "A2" } }
        ].filter((w, i, all) => all.findIndex((x) => x.collection === w.collection && x.id === w.id) === i));
        assert.equal(ok, false);
        assert.deepEqual(await snapshot(store), before);
      });
    }
  });

  test(name("a document that isn't JSON, or one id written twice: throws before writing"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      const before = await snapshot(store);
      const good = { collection: "notes", id: "a", expected: { id: "a", text: "A" }, next: { id: "a", text: "A2" } };
      await assert.rejects(store.writeBatch([good, { collection: "notes", id: "b", expected: { id: "b", text: "B" }, next: { big: 1n } }]), TypeError);
      await assert.rejects(store.writeBatch([good, { ...good, next: { id: "a", text: "A3" } }]), /"notes\/a" is written twice/);
      assert.deepEqual(await snapshot(store), before);
    })
  );

  test(name("scopeByProject: a batch writes the current project's collections"), { skip: backend.skip }, () =>
    withStore(backend, async (store) => {
      const scoped = scopeByProject(store);
      await runInProject("acme", () => scoped.writeBatch([{ collection: "notes", id: "x", expected: undefined, next: { id: "x" } }]));
      assert.deepEqual(await store.entries("acme::notes"), [["x", { id: "x" }]]);
      assert.deepEqual(await runInProject("acme", () => scoped.entries("notes")), [["x", { id: "x" }]]);
    })
  );
}

test("writeBatch (Sqlite): an error after some rows are written rolls every row back", { skip: !HAS_SQLITE && "node:sqlite not available" }, async () => {
  await withStore(BACKENDS[2], async (store, dir) => {
    const { DatabaseSync } = await import("node:sqlite");
    const other = new DatabaseSync(join(dir, "app.db"));
    other.exec("CREATE TRIGGER fail_on_boom BEFORE INSERT ON nexo_documents WHEN NEW.id = 'boom' BEGIN SELECT RAISE(ABORT, 'boom refused'); END");
    other.close();
    const before = await snapshot(store);
    await assert.rejects(
      store.writeBatch([
        { collection: "notes", id: "a", expected: { id: "a", text: "A" }, next: { id: "a", text: "A2" } },
        { collection: "notes", id: "b", expected: { id: "b", text: "B" }, next: undefined },
        { collection: "notes", id: "boom", expected: undefined, next: { id: "boom" } }
      ]),
      /boom refused/
    );
    assert.deepEqual(await snapshot(store), before);
    // The connection is usable afterwards: no transaction was left open.
    assert.equal(await store.writeBatch([{ collection: "notes", id: "a", expected: { id: "a", text: "A" }, next: { id: "a", text: "A3" } }]), true);
  });
});

test("writeBatch (Sqlite): another connection's write between read and batch makes the batch refuse", { skip: !HAS_SQLITE && "node:sqlite not available" }, async () => {
  await withStore(BACKENDS[2], async (store, dir) => {
    const other = await createSqliteDocumentStore(join(dir, "app.db"));
    const read = await store.get("notes", "a");
    await other.put("notes", "a", { id: "a", text: "changed by another process" });
    assert.equal(await store.writeBatch([{ collection: "notes", id: "a", expected: read, next: { ...read, text: "A2" } }]), false);
    assert.equal((await store.get("notes", "a")).text, "changed by another process");
    await other.close();
  });
});

test("writeBatch (File): a failed file write leaves the file and the in-memory data as they were", async () => {
  await withStore(BACKENDS[1], async (store, dir) => {
    const fileBefore = await readFile(join(dir, "app.json"), "utf8");
    const before = await snapshot(store);
    const rename = fsPromises.rename;
    fsPromises.rename = async () => {
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(
        store.writeBatch([{ collection: "notes", id: "a", expected: { id: "a", text: "A" }, next: { id: "a", text: "A2" } }]),
        /disk full/
      );
    } finally {
      fsPromises.rename = rename;
      syncBuiltinESMExports();
    }
    assert.deepEqual(await snapshot(store), before, "readers never saw the unsaved change");
    assert.equal(await readFile(join(dir, "app.json"), "utf8"), fileBefore);
  });
});

test("writeBatch (File): writes started during a batch wait for it, and both reach the file", async () => {
  await withStore(BACKENDS[1], async (store, dir) => {
    const batch = store.writeBatch([{ collection: "notes", id: "a", expected: { id: "a", text: "A" }, next: { id: "a", text: "A2" } }]);
    const put = store.put("notes", "c", { id: "c", text: "C" });
    const insert = store.insert("notes", "d", { id: "d" });
    assert.deepEqual(await Promise.all([batch, put, insert]), [true, undefined, true]);
    const onDisk = JSON.parse(await readFile(join(dir, "app.json"), "utf8"));
    assert.deepEqual(Object.keys(onDisk.notes).sort(), ["a", "b", "c", "d"]);
    assert.equal(onDisk.notes.a.text, "A2");
    // A write the batch didn't expect: it refuses, and the other write survives.
    const stale = store.writeBatch([{ collection: "notes", id: "c", expected: undefined, next: { id: "c" } }]);
    assert.equal(await stale, false);
    assert.equal((await store.get("notes", "c")).text, "C");
  });
});
