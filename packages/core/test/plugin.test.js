import { test } from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../dist/application.js";
import { NexoPluginError, NexoLifecycleError } from "../dist/errors.js";

test("registers and installs plugins", async () => {
  const app = createApplication({ name: "plugin-test" });
  let installedWithOption = null;

  const testPlugin = {
    name: "metrics-plugin",
    version: "1.0.0",
    install(application, options) {
      installedWithOption = options;
      application.module({
        name: "metrics",
        purpose: "Collect runtime metrics"
      });
    }
  };

  await app.use(testPlugin, { sampleRate: 0.5 });

  assert.equal(app.hasPlugin("metrics-plugin"), true);
  assert.equal(app.getPlugin("metrics-plugin")?.name, "metrics-plugin");
  assert.equal(app.getPlugins().length, 1);
  assert.deepEqual(installedWithOption, { sampleRate: 0.5 });
  assert.ok(app.getModule("metrics"));
});

test("rejects duplicate plugin registration", async () => {
  const app = createApplication({ name: "plugin-test" });
  const plugin = {
    name: "auth-plugin",
    install() {}
  };

  await app.use(plugin);

  await assert.rejects(
    async () => {
      await app.use(plugin);
    },
    (err) => err instanceof NexoPluginError && err.message.includes("already installed")
  );
});

test("enforces plugin dependencies", async () => {
  const app = createApplication({ name: "plugin-test" });

  const dependentPlugin = {
    name: "advanced-auth",
    dependencies: ["base-auth"],
    install() {}
  };

  await assert.rejects(
    async () => {
      await app.use(dependentPlugin);
    },
    (err) => err instanceof NexoPluginError && err.message.includes("requires dependency plugin \"base-auth\"")
  );

  const basePlugin = {
    name: "base-auth",
    install() {}
  };

  await app.use(basePlugin);
  await app.use(dependentPlugin);

  assert.equal(app.hasPlugin("advanced-auth"), true);
});

test("cannot install plugins while application is running", async () => {
  const app = createApplication({ name: "running-test" });
  await app.start();

  await assert.rejects(
    async () => {
      await app.use({
        name: "late-plugin",
        install() {}
      });
    },
    (err) => err instanceof NexoLifecycleError
  );

  await app.stop();
});
