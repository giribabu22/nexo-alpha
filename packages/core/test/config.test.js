import test from "node:test";
import assert from "node:assert/strict";

import { loadEnvConfig, defineConfig, createApplication } from "../dist/index.js";

test("loadEnvConfig parses prefix matching variables with type coercion", () => {
  const env = {
    NEXO_PORT: "8080",
    NEXO_DEBUG: "true",
    NEXO_DISABLED: "false",
    NEXO_REGION: "us-east-1",
    NEXO_CONFIG_JSON: '{"poolSize":10}',
    OTHER_VAR: "ignored"
  };

  const config = loadEnvConfig({ env, prefix: "NEXO_" });

  assert.deepEqual(config, {
    port: 8080,
    debug: true,
    disabled: false,
    region: "us-east-1",
    configJson: { poolSize: 10 }
  });
});

test("loadEnvConfig uses custom prefix", () => {
  const env = {
    APP_SERVICE_NAME: "order-service",
    APP_RETRIES: "3",
    NEXO_IGNORED: "true"
  };

  const config = loadEnvConfig({ env, prefix: "APP_" });

  assert.deepEqual(config, {
    serviceName: "order-service",
    retries: 3
  });
});

test("defineConfig passes through the typed configuration object", () => {
  const conf = defineConfig({
    region: "eu-west-1",
    timeoutMs: 5000
  });

  assert.deepEqual(conf, {
    region: "eu-west-1",
    timeoutMs: 5000
  });

  const app = createApplication({ name: "app", config: conf });
  assert.equal(app.getConfig("region"), "eu-west-1");
  assert.equal(app.getConfig("timeoutMs"), 5000);
});
