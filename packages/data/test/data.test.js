import test from "node:test";
import assert from "node:assert/strict";

import * as core from "@nexo-alpha/core";
import * as coreModel from "@nexo-alpha/core/model";
import * as data from "../dist/index.js";
import * as dataModel from "../dist/model.js";

test("every export is the core implementation itself, not a copy", () => {
  const names = Object.keys(data).sort();
  assert.deepEqual(names, [
    "FILES_PATH", "LIST_PARAMS", "NexoHttpError", "NexoValidationError", "RESOURCE_OPERATIONS", "SYSTEM_FIELDS",
    "createDiskBlobStore", "createFileDocumentStore", "createFiles", "createInMemoryBlobStore", "createInMemoryDocumentStore",
    "createSqliteDocumentStore", "currentProjectId", "decodeListQuery", "encodeListQuery", "errorsByField", "field", "humanize",
    "insertDocument", "mimeMatches", "model", "queryDocuments", "resource", "resourcePath", "runInProject", "scopeByProject",
    "validateField", "validateSchema"
  ]);
  for (const name of names) {
    assert.equal(data[name], core[name], name);
  }
});

test("the browser entry is exactly @nexo-alpha/core/model, with no server code", () => {
  assert.deepEqual(Object.keys(dataModel).sort(), Object.keys(coreModel).sort());
  for (const name of Object.keys(dataModel)) assert.equal(dataModel[name], coreModel[name], name);
  for (const serverOnly of ["resource", "createFileDocumentStore", "createSqliteDocumentStore", "createFiles", "createAuth"]) {
    assert.equal(dataModel[serverOnly], undefined, serverOnly);
  }
});

test("a model and resource built from @nexo-alpha/data work with a core application", async () => {
  const Task = data.model("tasks", { title: data.field.string({ minLength: 1 }), done: data.field.boolean().default(false) });
  const tasks = data.resource(Task, { store: data.createInMemoryDocumentStore(), searchable: ["title"] });
  const app = core.createApplication({ name: "data-package" });
  app.module(tasks);

  await tasks.create({ title: "Write the README" });
  const page = await tasks.list({ search: "readme" });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].done, false);
  await assert.rejects(() => tasks.create({ title: "" }), data.NexoValidationError);
  assert.deepEqual(app.getApis().map((api) => api.name), ["tasks.list", "tasks.get", "tasks.create", "tasks.update", "tasks.delete"]);
});
