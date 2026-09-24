import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createNexoApp, sanitizeProjectName } from "../dist/generator.js";

test("sanitizeProjectName transforms strings into valid npm/directory names", () => {
  assert.equal(sanitizeProjectName("My Awesome App!"), "my-awesome-app");
  assert.equal(sanitizeProjectName("---Test_Project---"), "test_project");
  assert.equal(sanitizeProjectName(""), "my-nexo-app");
});

test("creates fullstack-react project files with customized project name and production dockerfile", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexo-fullstack-"));
  const appDir = path.join(tempDir, "Super App");

  try {
    const result = await createNexoApp({
      targetDir: appDir,
      templateName: "fullstack-react"
    });

    assert.equal(result.projectName, "super-app");
    assert.equal(result.template.name, "fullstack-react");

    // Check root files
    const rootPkg = JSON.parse(await fs.readFile(path.join(appDir, "package.json"), "utf8"));
    assert.equal(rootPkg.name, "super-app");

    const dockerfile = await fs.readFile(path.join(appDir, "Dockerfile"), "utf8");
    assert.match(dockerfile, /FROM node:20-alpine/);

    const envExample = await fs.readFile(path.join(appDir, ".env.example"), "utf8");
    assert.match(envExample, /PORT=4000/);

    // Check backend files
    const backendPkg = JSON.parse(await fs.readFile(path.join(appDir, "backend", "package.json"), "utf8"));
    assert.equal(backendPkg.name, "super-app-backend");
    assert.equal(backendPkg.dependencies["@nexo-alpha/tools"], "^0.3.2");
    assert.ok(backendPkg.dependencies["@nexo-alpha/behavior"]);
    assert.ok(backendPkg.dependencies["@nexo-alpha/agent"]);
    assert.equal(backendPkg.scripts.graph, "nexo graph --source-root src --out .nexo/knowledge-graph.json");

    const appTs = await fs.readFile(path.join(appDir, "backend", "src", "app.ts"), "utf8");
    assert.match(appTs, /name: "super-app-backend"/);
    assert.match(appTs, /registerTodosModule\(app\)/);

    const todoServiceTs = await fs.readFile(
      path.join(appDir, "backend", "src", "modules", "todos", "service.ts"),
      "utf8"
    );
    assert.match(todoServiceTs, /class TodoService implements NexoService/);

    // Check frontend files
    const frontendPkg = JSON.parse(await fs.readFile(path.join(appDir, "frontend", "package.json"), "utf8"));
    assert.equal(frontendPkg.name, "super-app-frontend");
    assert.ok(frontendPkg.dependencies["react"]);

    const indexHtml = await fs.readFile(path.join(appDir, "frontend", "index.html"), "utf8");
    assert.match(indexHtml, /super-app — Powered by Nexo/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("creates backend-api project files with customized project name", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexo-backend-"));
  const appDir = path.join(tempDir, "order-service");

  try {
    const result = await createNexoApp({
      targetDir: appDir,
      templateName: "backend-api"
    });

    assert.equal(result.projectName, "order-service");

    const pkg = JSON.parse(await fs.readFile(path.join(appDir, "package.json"), "utf8"));
    assert.equal(pkg.name, "order-service");
    assert.ok(pkg.dependencies["@nexo-alpha/core"]);
    assert.ok(pkg.dependencies["@nexo-alpha/hapi"]);
    assert.equal(pkg.dependencies["@nexo-alpha/tools"], "^0.3.2");
    assert.ok(pkg.dependencies["@nexo-alpha/behavior"]);
    assert.ok(pkg.dependencies["@nexo-alpha/agent"]);
    assert.equal(pkg.scripts.graph, "nexo graph --source-root src --out .nexo/knowledge-graph.json");

    const dockerfile = await fs.readFile(path.join(appDir, "Dockerfile"), "utf8");
    assert.match(dockerfile, /FROM node:20-alpine/);

    const appTs = await fs.readFile(path.join(appDir, "src", "app.ts"), "utf8");
    assert.match(appTs, /name: "order-service"/);
    assert.match(appTs, /registerGreetingModule\(app\)/);

    const greetingServiceTs = await fs.readFile(
      path.join(appDir, "src", "modules", "greeting", "service.ts"),
      "utf8"
    );
    assert.match(greetingServiceTs, /class StorageService implements NexoService/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("creates minimal project files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexo-min-"));
  const appDir = path.join(tempDir, "quick-test");

  try {
    const result = await createNexoApp({
      targetDir: appDir,
      templateName: "minimal"
    });

    assert.equal(result.projectName, "quick-test");

    const pkg = JSON.parse(await fs.readFile(path.join(appDir, "package.json"), "utf8"));
    assert.equal(pkg.name, "quick-test");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("throws error when unknown template is provided", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexo-err-"));
  try {
    await assert.rejects(
      createNexoApp({
        targetDir: path.join(tempDir, "app"),
        templateName: "non-existent-template"
      }),
      /Unknown template "non-existent-template"/
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
