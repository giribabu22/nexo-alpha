import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createApplication,
  createFiles,
  createDiskBlobStore,
  createInMemoryBlobStore,
  createInMemoryDocumentStore,
  field,
  mimeMatches,
  model,
  resource,
  NexoHttpError,
  NexoValidationError,
  NexoConfigurationError
} from "../dist/index.js";

const bytes = (text) => new TextEncoder().encode(text);

test("blob stores round-trip bytes and refuse keys that could escape their directory", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "nexo-blobs-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const blobs of [createInMemoryBlobStore(), createDiskBlobStore(join(dir, "files"))]) {
    await blobs.put("a-1", bytes("hello"));
    assert.equal(new TextDecoder().decode(await blobs.get("a-1")), "hello");
    assert.equal(await blobs.get("missing"), undefined);
    assert.equal(await blobs.delete("a-1"), true);
    assert.equal(await blobs.delete("a-1"), false);
    for (const key of ["../escape", "a/b", "..", "", "a\\b", "x".repeat(129)]) {
      await assert.rejects(() => blobs.put(key, bytes("x")), NexoConfigurationError, key);
    }
  }
  assert.deepEqual(await readdir(join(dir, "files")), [], "no temporary files left behind");
});

test("upload stores content and metadata; names and types are cleaned", async () => {
  const files = createFiles({ store: createInMemoryDocumentStore(), blobs: createInMemoryBlobStore() });
  const file = await files.upload(bytes("hi"), { name: "C:\\Users\\ann\\..\\report\u0007.txt", type: "Text/Plain; charset=utf-8", uploadedBy: "u1" });
  assert.equal(file.name, "report.txt");
  assert.equal(file.type, "text/plain");
  assert.equal(file.size, 2);
  assert.equal(file.sha256, "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4");
  assert.equal(file.url, `/api/files/${file.id}`);
  assert.equal(file.uploadedBy, "u1");

  const found = await files.read(file.id);
  assert.deepEqual(found.file, file);
  assert.equal(new TextDecoder().decode(found.data), "hi");

  assert.equal((await files.upload(bytes("x"), { name: "..", type: "not a type" })).name, "file");
  assert.equal((await files.upload(bytes("x"), { type: "<script>" })).type, "application/octet-stream");

  await files.delete(file.id);
  assert.equal(await files.read(file.id), undefined);
  await assert.rejects(() => files.delete(file.id), (error) => error.statusCode === 404);
  assert.equal(await files.info("../../etc/passwd"), undefined);
});

test("upload enforces size and type limits", async () => {
  const files = createFiles({ store: createInMemoryDocumentStore(), blobs: createInMemoryBlobStore(), maxBytes: 4, accept: ["image/*"] });
  const status = (promise) => promise.then(() => 0, (error) => (error instanceof NexoHttpError ? error.statusCode : -1));
  assert.equal(await status(files.upload(bytes(""), { type: "image/png" })), 400);
  assert.equal(await status(files.upload(bytes("12345"), { type: "image/png" })), 413);
  assert.equal(await status(files.upload(bytes("1234"), { type: "text/html" })), 415);
  assert.equal(await status(files.upload(bytes("1234"), { type: "image/png" })), 0);
});

test("mimeMatches handles wildcards, parameters and case", () => {
  assert.equal(mimeMatches("image/PNG", ["image/*"]), true);
  assert.equal(mimeMatches("text/plain; charset=utf-8", ["text/plain"]), true);
  assert.equal(mimeMatches("application/pdf", ["image/*", "*/*"]), true);
  assert.equal(mimeMatches("image/svg+xml", ["image/png"]), false);
  assert.equal(mimeMatches("imagex/png", ["image/*"]), false);
});

test("field.file() must reference an uploaded file of an accepted type", async () => {
  const store = createInMemoryDocumentStore();
  const files = createFiles({ store, blobs: createInMemoryBlobStore() });
  const Profile = model("profiles", { photo: field.file({ accept: ["image/*"] }), cv: field.file().optional() });
  const profiles = resource(Profile, { store });

  const photo = await files.upload(bytes("png"), { name: "me.png", type: "image/png" });
  const pdf = await files.upload(bytes("pdf"), { name: "cv.pdf", type: "application/pdf" });

  const profile = await profiles.create({ photo: photo.id, cv: pdf.id });
  assert.equal(profile.photo, photo.id);
  await assert.rejects(() => profiles.create({ photo: pdf.id }), (error) => {
    assert.ok(error instanceof NexoValidationError);
    assert.match(error.errors[0], /must be a file of type image\/\*, got application\/pdf/);
    return true;
  });
  await assert.rejects(() => profiles.create({ photo: "no-such-file" }), /missing files record/);
  assert.equal(Profile.fields.photo.kind, "file");
  assert.deepEqual(Profile.fields.photo.accept, ["image/*"]);
});

// ---------------------------------------------------------------------------
// Attachments and cleanup
// ---------------------------------------------------------------------------

function attachmentSetup(cleanup) {
  const store = createInMemoryDocumentStore();
  const blobs = createInMemoryBlobStore();
  const files = createFiles({ store, blobs, ...(cleanup !== undefined ? { cleanup } : {}) });
  const Profile = model("profiles", { name: field.string(), photo: field.file().optional() });
  const profiles = resource(Profile, { store });
  const upload = () => files.upload(bytes("img"), { name: "a.png", type: "image/png" });
  return { store, blobs, files, profiles, upload };
}

test("records claim their files; a file belongs to one record", async () => {
  const { files, profiles, upload } = attachmentSetup();
  const photo = await upload();
  const ann = await profiles.create({ name: "Ann", photo: photo.id });
  assert.equal((await files.info(photo.id)).attachedTo, `profiles/${ann.id}`);

  await assert.rejects(() => profiles.create({ name: "Bob", photo: photo.id }), (error) => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, "FILE_IN_USE");
    return true;
  });
  assert.equal((await profiles.list()).total, 1, "the second record was not stored");
});

test("replacing or deleting releases files; cleanup removes them after the delay", async () => {
  const { files, blobs, profiles, upload } = attachmentSetup({ removeDetachedAfterMs: 1000 });
  const first = await upload();
  const second = await upload();
  const ann = await profiles.create({ name: "Ann", photo: first.id });

  await profiles.update(ann.id, { photo: second.id });
  const released = await files.info(first.id);
  assert.equal(released.attachedTo, undefined);
  assert.ok(released.detachedAt);
  assert.equal((await files.info(second.id)).attachedTo, `profiles/${ann.id}`);

  assert.deepEqual(await files.sweep(Date.now()), [], "not before the delay");
  assert.deepEqual(await files.sweep(Date.now() + 2000), [first.id]);
  assert.equal(await files.info(first.id), undefined);
  assert.equal(await blobs.get(first.id), undefined, "content removed too");

  await profiles.update(ann.id, { photo: null });
  await profiles.create({ name: "Cy", photo: (await upload()).id });
  const cy = (await profiles.list({ where: { name: "Cy" } })).items[0];
  await profiles.delete(cy.id);
  assert.equal((await files.sweep(Date.now() + 2000)).length, 2, "cleared and deleted records release their files");
});

test("never-used uploads are kept unless removeUnattachedAfterMs is set", async () => {
  const kept = attachmentSetup();
  const orphan = await kept.upload();
  assert.deepEqual(await kept.files.sweep(Date.now() + 365 * 24 * 3600 * 1000), []);
  assert.ok(await kept.files.info(orphan.id));

  const strict = attachmentSetup({ removeUnattachedAfterMs: 1000 });
  const stale = await strict.upload();
  const used = await strict.upload();
  await strict.profiles.create({ name: "Ann", photo: used.id });
  assert.deepEqual(await strict.files.sweep(Date.now() + 2000), [stale.id]);
});

test("a failed record write gives its file claims back", async () => {
  const store = createInMemoryDocumentStore();
  const files = createFiles({ store, blobs: createInMemoryBlobStore() });
  const failing = { ...store, put: async (collection, id, doc) => { if (collection === "profiles") throw new Error("disk full"); return store.put(collection, id, doc); } };
  const profiles = resource(model("profiles", { photo: field.file() }), { store: failing });
  const photo = await files.upload(bytes("x"), { type: "image/png" });
  await assert.rejects(() => profiles.create({ photo: photo.id }), /disk full/);
  assert.equal((await files.info(photo.id)).attachedTo, undefined);
});

test("attach/detach for references kept by your own code; files being removed cannot be attached", async () => {
  const { files, store, upload } = attachmentSetup({ removeDetachedAfterMs: 0 });
  const file = await upload();
  await files.attach(file.id, "invoices/42");
  await assert.rejects(() => files.attach(file.id, "invoices/43"), (e) => e.code === "FILE_IN_USE");
  await files.detach(file.id, "invoices/43"); // not the owner: no effect
  assert.equal((await files.info(file.id)).attachedTo, "invoices/42");
  await files.detach(file.id);
  assert.equal((await files.info(file.id)).attachedTo, undefined);

  const doc = await store.get("files", file.id);
  await store.put("files", file.id, { ...doc, removing: true });
  await assert.rejects(() => files.attach(file.id, "invoices/44"), (e) => e.statusCode === 404);
});

test("the cleanup timer follows the app lifecycle", async () => {
  const { files } = attachmentSetup({ everyMs: 10 });
  const app = createApplication({ name: "files-lifecycle" });
  app.module(files);
  await app.start();
  await app.stop();
  const off = createFiles({ store: createInMemoryDocumentStore(), blobs: createInMemoryBlobStore(), cleanup: false });
  off.start();
  off.stop();
});
