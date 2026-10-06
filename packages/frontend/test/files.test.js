/** Uploads end to end: NexoClient.files → HTTP → createFiles() → blob store, linked from a record. */
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";

import {
  createApplication,
  createFiles,
  createInMemoryBlobStore,
  createInMemoryDocumentStore,
  field,
  model,
  resource
} from "@nexo-alpha/core";
import { startHapiServer } from "@nexo-alpha/hapi";
import { createNexoClient, NexoApiError, NexoForm, NexoProvider, NexoTable, NexoSession } from "../dist/index.js";

const Document = model("documents", {
  title: field.string(),
  attachment: field.file({ accept: ["application/pdf", "image/*"] })
});

async function startServer() {
  const store = createInMemoryDocumentStore();
  const app = createApplication({ name: "docs" });
  app.module(createFiles({ store, blobs: createInMemoryBlobStore(), maxBytes: 1024, accept: ["application/pdf", "image/*", "text/plain"] }));
  app.module(resource(Document, { store }));
  const server = await startHapiServer(app, { port: 0, logging: false, bindLifecycle: false });
  return { server, client: createNexoClient({ baseUrl: server.info.uri, session: new NexoSession({ storage: null }) }) };
}

test("upload a Blob, download it, and attach it to a record", async (t) => {
  const { server, client } = await startServer();
  t.after(() => server.stop());

  const pdf = new Blob(["%PDF-1.4 hello"], { type: "application/pdf" });
  const file = await client.files.upload(pdf, { name: "report.pdf" });
  assert.deepEqual([file.name, file.type, file.size], ["report.pdf", "application/pdf", 14]);
  assert.equal(client.files.url(file.id), `${server.info.uri}/api/files/${file.id}`);
  assert.deepEqual(await client.files.info(file.id), file);
  assert.equal(await (await client.files.download(file.id)).text(), "%PDF-1.4 hello");

  const record = await client.resource(Document).create({ title: "Q3", attachment: file.id });
  assert.equal(record.attachment, file.id);

  const text = await client.files.upload(new Blob(["hi"], { type: "text/plain" }), { name: "a.txt" });
  const rejected = await client.resource(Document).create({ title: "x", attachment: text.id }).catch((error) => error);
  assert.ok(rejected instanceof NexoApiError);
  assert.equal(rejected.status, 400, "the model only accepts PDFs and images");

  const tooBig = await client.files.upload(new Blob([new Uint8Array(2048)], { type: "image/png" })).catch((error) => error);
  assert.equal(tooBig.status, 413);

  await client.files.delete(file.id);
  await assert.rejects(() => client.files.download(file.id), (error) => error.status === 404);
});

test("NexoForm shows a file picker; NexoTable links to the file", () => {
  const client = createNexoClient({ baseUrl: "https://api.example.com", session: new NexoSession({ storage: null }) });
  const form = renderToString(React.createElement(NexoProvider, { client }, React.createElement(NexoForm, { model: Document })));
  assert.match(form, /type="file"/);
  assert.match(form, /accept="application\/pdf,image\/\*"/);

  const table = renderToString(
    React.createElement(NexoProvider, { client }, React.createElement(NexoTable, { model: Document, rows: [{ id: "r1", title: "Q3", attachment: "f-1" }] }))
  );
  assert.ok(table.includes('href="https://api.example.com/api/files/f-1"'));
  assert.ok(table.includes(">Download<"));
});
