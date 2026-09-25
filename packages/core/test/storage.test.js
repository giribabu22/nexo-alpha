import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { readdir } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  createFileDocumentStore,
  createInMemoryDocumentStore,
  createSqliteDocumentStore
} from "../dist/index.js";

const HAS_SQLITE = await import("node:sqlite").then(() => true, () => false);

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "nexo-storage-test-"));
}

const backends = [
  { name: "InMemory", create: async () => ({ store: createInMemoryDocumentStore(), cleanup: async () => {} }) },
  {
    name: "File",
    create: async () => {
      const dir = await tempDir();
      return {
        store: createFileDocumentStore(path.join(dir, "nested", "db.json")),
        cleanup: () => fs.rm(dir, { recursive: true, force: true })
      };
    }
  },
  {
    name: "Sqlite",
    skip: !HAS_SQLITE && "node:sqlite not available",
    create: async () => {
      const dir = await tempDir();
      const store = await createSqliteDocumentStore(path.join(dir, "nested", "db.sqlite"));
      return {
        store,
        cleanup: async () => {
          await store.close();
          await fs.rm(dir, { recursive: true, force: true });
        }
      };
    }
  }
];

for (const backend of backends) {
  const it = (title, fn) =>
    test(`DocumentStore (${backend.name}): ${title}`, { skip: backend.skip }, async () => {
      const { store, cleanup } = await backend.create();
      try {
        await fn(store);
      } finally {
        await cleanup();
      }
    });

  it("put, get, delete within a collection", async (store) => {
    await store.put("users", "u1", { name: "Ann" });
    assert.deepEqual(await store.get("users", "u1"), { name: "Ann" });
    assert.equal(await store.get("users", "missing"), undefined);
    assert.equal(await store.get("other", "u1"), undefined);

    assert.equal(await store.delete("users", "u1"), true);
    assert.equal(await store.delete("users", "u1"), false);
    assert.equal(await store.get("users", "u1"), undefined);
  });

  it("put replaces, and list keeps first-insertion order per collection", async (store) => {
    await store.put("c", "b", { v: 1 });
    await store.put("c", "a", { v: 2 });
    await store.put("c", "b", { v: 3 });
    await store.put("d", "z", { v: 4 });

    assert.deepEqual(await store.list("c"), [{ v: 3 }, { v: 2 }]);
    assert.deepEqual(await store.list("d"), [{ v: 4 }]);
    assert.deepEqual(await store.list("empty"), []);
  });

  it("stored and returned documents are copies", async (store) => {
    const doc = { list: [1] };
    await store.put("c", "x", doc);
    doc.list.push(2);
    (await store.get("c", "x")).list.push(3);
    (await store.list("c"))[0].list.push(4);

    assert.deepEqual(await store.get("c", "x"), { list: [1] });
  });

  it("concurrent writes are not lost", async (store) => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.put("c", `id-${i}`, { i })));
    assert.equal((await store.list("c")).length, 25);
  });

  it("replaceIf: swaps only when the current document matches; exactly one concurrent swap wins", async (store) => {
    await store.put("jobs", "j1", { status: "queued", n: 1 });
    const seen = await store.get("jobs", "j1");

    assert.equal(await store.replaceIf("jobs", "j1", { status: "queued", n: 2 }, { status: "running" }), false);
    assert.equal(await store.replaceIf("jobs", "missing", seen, { status: "running" }), false);

    const outcomes = await Promise.all(
      ["w1", "w2", "w3"].map((worker) => store.replaceIf("jobs", "j1", seen, { status: "running", worker }))
    );
    assert.equal(outcomes.filter(Boolean).length, 1);
    assert.equal((await store.get("jobs", "j1")).status, "running");
  });

  it("rejects values that are not JSON-serializable", async (store) => {
    await assert.rejects(store.put("c", "x", undefined), /JSON-serializable/);
  });
}

test("DocumentStore (File): data survives reopening; empty files are treated as empty", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "db.json");
  try {
    await createFileDocumentStore(file).put("c", "x", { ok: true });
    assert.deepEqual(await createFileDocumentStore(file).get("c", "x"), { ok: true });

    await fs.writeFile(file, "");
    assert.deepEqual(await createFileDocumentStore(file).list("c"), []);

    const leftovers = (await fs.readdir(dir)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("DocumentStore (Sqlite): data survives reopening; closed stores refuse use; table names are validated", { skip: !HAS_SQLITE && "node:sqlite not available" }, async () => {
  const dir = await tempDir();
  const file = path.join(dir, "db.sqlite");
  try {
    const first = await createSqliteDocumentStore(file);
    await first.put("c", "x", { ok: true });
    await first.close();
    await first.close();
    await assert.rejects(first.get("c", "x"), /closed/);

    const second = await createSqliteDocumentStore(file);
    assert.deepEqual(await second.get("c", "x"), { ok: true });
    await second.close();

    const custom = await createSqliteDocumentStore(":memory:", { table: "my_docs" });
    await custom.put("c", "x", 1);
    assert.equal(await custom.get("c", "x"), 1);
    await custom.close();

    await assert.rejects(createSqliteDocumentStore(":memory:", { table: "docs; DROP TABLE x" }), /Invalid SQLite table name/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("DocumentStore (Sqlite): replaceIf is atomic across separate connections to one file", { skip: !HAS_SQLITE && "node:sqlite not available" }, async () => {
  const dir = await tempDir();
  const file = path.join(dir, "shared.sqlite");
  const a = await createSqliteDocumentStore(file);
  const b = await createSqliteDocumentStore(file);
  try {
    await a.put("jobs", "j1", { status: "queued" });
    const seenByA = await a.get("jobs", "j1");
    const seenByB = await b.get("jobs", "j1");

    assert.equal(await a.replaceIf("jobs", "j1", seenByA, { status: "running", worker: "a" }), true);
    assert.equal(await b.replaceIf("jobs", "j1", seenByB, { status: "running", worker: "b" }), false);
    assert.equal((await b.get("jobs", "j1")).worker, "a");
  } finally {
    await a.close();
    await b.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("DocumentStore (File): concurrent writes are group-committed and all durable once awaited", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "db.json");
  try {
    const store = createFileDocumentStore(file);
    await Promise.all(Array.from({ length: 200 }, (_, i) => store.put("c", `id-${i}`, { i })));
    await store.delete("c", "id-0");

    const reopened = createFileDocumentStore(file);
    assert.equal((await reopened.list("c")).length, 199);
    assert.deepEqual(await reopened.get("c", "id-199"), { i: 199 });
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("DocumentStore (File): a failed write rejects, and the store reloads from disk afterwards", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "db.json");
  try {
    const store = createFileDocumentStore(file);
    await store.put("c", "kept", { ok: true });

    // Make the target unwritable by replacing the file with a directory.
    await fs.rm(file);
    await fs.mkdir(file);
    await assert.rejects(store.put("c", "lost", { ok: false }));

    await fs.rm(file, { recursive: true });
    await fs.writeFile(file, JSON.stringify({ c: { kept: { ok: true } } }));
    assert.equal(await store.get("c", "lost"), undefined);
    assert.deepEqual(await store.get("c", "kept"), { ok: true });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
