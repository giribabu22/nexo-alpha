import { test } from "node:test";
import assert from "node:assert/strict";
import { NexoMiddlewarePipeline } from "../dist/middleware.js";

test("middleware pipeline executes in onion order", async () => {
  const pipeline = new NexoMiddlewarePipeline();
  const trail = [];

  pipeline.use(async (ctx, next) => {
    trail.push("m1:before");
    const res = await next();
    trail.push("m1:after");
    return res;
  });

  pipeline.use(async (ctx, next) => {
    trail.push("m2:before");
    const res = await next();
    trail.push("m2:after");
    return res;
  });

  const output = await pipeline.execute({ count: 10 }, async (ctx) => {
    trail.push("handler");
    return ctx.count * 2;
  });

  assert.equal(output, 20);
  assert.deepEqual(trail, [
    "m1:before",
    "m2:before",
    "handler",
    "m2:after",
    "m1:after"
  ]);
});

test("middleware can short-circuit pipeline", async () => {
  const pipeline = new NexoMiddlewarePipeline();
  const trail = [];

  pipeline.use(async (ctx, next) => {
    trail.push("m1:short-circuit");
    return "blocked";
  });

  pipeline.use(async (ctx, next) => {
    trail.push("m2");
    return await next();
  });

  const output = await pipeline.execute({}, async () => {
    trail.push("handler");
    return "success";
  });

  assert.equal(output, "blocked");
  assert.deepEqual(trail, ["m1:short-circuit"]);
});

test("middleware throws if next() is called multiple times", async () => {
  const pipeline = new NexoMiddlewarePipeline();

  pipeline.use(async (ctx, next) => {
    await next();
    return await next();
  });

  await assert.rejects(
    async () => {
      await pipeline.execute({}, async () => "ok");
    },
    /next\(\) called multiple times/
  );
});
