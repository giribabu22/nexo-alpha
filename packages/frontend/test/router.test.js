import test from "node:test";
import assert from "node:assert/strict";
import { createNexoRouter } from "../dist/index.js";

test("NexoRouter matches and caches routes with LRU", () => {
  const router = createNexoRouter([
    { path: "/", component: "HomeComponent" },
    { path: "/todos/:id", component: "TodoComponent" }
  ]);

  const match1 = router.match("/todos/123");
  assert.ok(match1);
  assert.equal(match1.component, "TodoComponent");
  assert.equal(match1.params.id, "123");

  // Second match uses LRU cache
  const match2 = router.match("/todos/123");
  assert.equal(match1, match2); // exact cached reference!
});

test("NexoRouter navigation notifies subscribers", () => {
  const router = createNexoRouter([
    { path: "/", component: "Home" },
    { path: "/settings", component: "Settings" }
  ]);

  let notifiedMatch = null;
  const unsubscribe = router.subscribe((m) => {
    notifiedMatch = m;
  });

  router.navigate("/settings");
  assert.ok(notifiedMatch);
  assert.equal(notifiedMatch.component, "Settings");
  assert.equal(router.getCurrentPath(), "/settings");

  unsubscribe();
  router.navigate("/");
  assert.equal(notifiedMatch.component, "Settings"); // not notified after unsubscribe
});
