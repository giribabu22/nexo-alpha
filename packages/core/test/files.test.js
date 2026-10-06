import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
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
