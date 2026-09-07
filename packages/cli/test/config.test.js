import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { findNexoConfig, resolveConfiguredAppPath } from "../dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("findNexoConfig finds a config file in the start directory", async () => {
  const configDir = resolve(__dirname, "..", "fixtures", "with-config");
  const found = await findNexoConfig(configDir);

  assert.equal(found, join(configDir, "nexo.config.json"));
});

test("findNexoConfig walks up parent directories to find a config file", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexo-config-"));

  try {
    await writeFile(join(root, "nexo.config.json"), JSON.stringify({ app: "./app.js" }));

    const nested = join(root, "a", "b");
    await mkdir(nested, { recursive: true });

    const found = await findNexoConfig(nested);
    assert.equal(found, join(root, "nexo.config.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("findNexoConfig returns undefined when no config file exists", async () => {
  const noConfigDir = resolve(__dirname, "..", "fixtures", "no-config");
  const found = await findNexoConfig(noConfigDir);

  assert.equal(found, undefined);
});

test("resolveConfiguredAppPath resolves the app field relative to the config's directory", async () => {
  const configDir = resolve(__dirname, "..", "fixtures", "with-config");
  const appPath = await resolveConfiguredAppPath(configDir);

  assert.equal(appPath, resolve(__dirname, "..", "fixtures", "app.js"));
});

test("resolveConfiguredAppPath returns undefined when no config file exists", async () => {
  const noConfigDir = resolve(__dirname, "..", "fixtures", "no-config");
  const appPath = await resolveConfiguredAppPath(noConfigDir);

  assert.equal(appPath, undefined);
});

test("resolveConfiguredAppPath throws when the config file has no string app field", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexo-config-bad-"));

  try {
    await writeFile(join(root, "nexo.config.json"), JSON.stringify({}));

    await assert.rejects(resolveConfiguredAppPath(root), /must have a string "app" field/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
