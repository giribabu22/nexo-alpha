/** createFiles() over HTTP: raw uploads, defensive downloads, limits, auth. */
import test from "node:test";
import assert from "node:assert/strict";

import { createApplication, createAuth, createFiles, createInMemoryBlobStore, createInMemoryDocumentStore } from "@nexo-alpha/core";
import { createHapiServer } from "../dist/index.js";

async function serve(options = {}) {
  const store = createInMemoryDocumentStore();
  const auth = createAuth({ store, secret: "files-http-test-secret-0123456789abcdefgh", defaultScopes: ["files:write"] });
  const app = createApplication({ name: "files" });
  app.module(auth);
  app.module(createFiles({ store, blobs: createInMemoryBlobStore(), ...options }));
  const server = await createHapiServer(app, { logging: false, authenticate: auth.authenticate });
  return { server, auth };
}

const upload = (server, body, type, name = "a.bin", headers = {}) =>
  server.inject({ method: "POST", url: `/api/files?name=${encodeURIComponent(name)}`, payload: body, headers: { "content-type": type, ...headers } });

test("upload a raw body, then download it with safe headers", async () => {
  const { server } = await serve();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const created = await upload(server, png, "image/png", "photo.png");
  assert.equal(created.statusCode, 201);
  const file = JSON.parse(created.payload);
  assert.equal(created.headers.location, file.url);
  assert.deepEqual([file.name, file.type, file.size], ["photo.png", "image/png", 7]);

  const download = await server.inject(file.url);
  assert.equal(download.statusCode, 200);
  assert.deepEqual(download.rawPayload, png);
  assert.equal(download.headers["content-type"], "image/png");
  assert.equal(download.headers["content-disposition"], "inline; filename*=UTF-8''photo.png");
  assert.equal(download.headers["x-content-type-options"], "nosniff");
  assert.match(download.headers["content-security-policy"], /sandbox/);

  const info = await server.inject(`${file.url}/info`);
  assert.deepEqual(JSON.parse(info.payload), file);

  assert.equal((await server.inject({ method: "DELETE", url: file.url })).statusCode, 204);
  assert.equal((await server.inject(file.url)).statusCode, 404);
});

test("HTML and SVG uploads are always downloaded, never displayed", async () => {
  const { server } = await serve();
  for (const [type, name] of [["text/html", "x.html"], ["image/svg+xml", "x.svg"]]) {
    const file = JSON.parse((await upload(server, "<script>alert(1)</script>", type, name)).payload);
    const download = await server.inject(file.url);
    assert.match(download.headers["content-disposition"], /^attachment;/, type);
  }
});

test("size and type limits answer 413 and 415", async () => {
  const { server } = await serve({ maxBytes: 8, accept: ["image/*"] });
  assert.equal((await upload(server, "123456789", "image/png")).statusCode, 413);
  const wrongType = await upload(server, "1234", "application/pdf");
  assert.equal(wrongType.statusCode, 415);
  assert.equal(JSON.parse(wrongType.payload).code, "UNSUPPORTED_FILE_TYPE");
  assert.equal((await upload(server, "", "image/png")).statusCode, 400);
});

test("with auth, uploads need the write scope and record the uploader", async () => {
  const { server, auth } = await serve({ auth: { write: ["files:write"] } });
  assert.equal((await upload(server, "data", "text/plain")).statusCode, 401);

  const { token, user } = await auth.register({ email: "ann@example.com", password: "correct horse" });
  const created = await upload(server, "data", "text/plain", "notes.txt", { authorization: `Bearer ${token}` });
  assert.equal(created.statusCode, 201);
  const file = JSON.parse(created.payload);
  assert.equal(file.uploadedBy, user.id);
  assert.equal((await server.inject(file.url)).statusCode, 200, "reads stay public without auth.read");
  assert.equal((await server.inject({ method: "DELETE", url: file.url })).statusCode, 401);
});
