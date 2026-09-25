/**
 * @nexo-alpha/decision — RBAC tests
 *
 * Run after building:  pnpm --filter @nexo-alpha/decision build && node --test
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createAccessControl,
  createDecisionEngine,
  permissionMatches,
  rbacRule
} from "../dist/index.js";

const ROLES = [
  { name: "viewer", permissions: ["orders:read"] },
  { name: "support", permissions: ["orders:refund"], inherits: ["viewer"] },
  { name: "manager", permissions: ["orders:*"], inherits: ["support"] },
  { name: "admin", permissions: ["*"] }
];

test("permissionMatches: exact, global wildcard and namespace wildcard", () => {
  assert.equal(permissionMatches("orders:read", "orders:read"), true);
  assert.equal(permissionMatches("*", "anything:at:all"), true);
  assert.equal(permissionMatches("orders:*", "orders:refund"), true);
  assert.equal(permissionMatches("orders:*", "orders:items:delete"), true);
  assert.equal(permissionMatches("orders:*", "ordersx:read"), false);
  assert.equal(permissionMatches("orders:*", "orders"), false);
  assert.equal(permissionMatches("orders:read", "orders:refund"), false);
});

test("AccessControl: inheritance is transitive and unknown roles grant nothing", () => {
  const access = createAccessControl(ROLES);

  assert.deepEqual(access.roles, ["viewer", "support", "manager", "admin"]);
  assert.deepEqual([...access.permissionsFor(["support"])].sort(), ["orders:read", "orders:refund"]);
  assert.deepEqual([...access.permissionsFor(["manager"])].sort(), ["orders:*", "orders:read", "orders:refund"]);

  assert.equal(access.can(["viewer"], "orders:read"), true);
  assert.equal(access.can(["viewer"], "orders:refund"), false);
  assert.equal(access.can(["manager"], "orders:cancel"), true);
  assert.equal(access.can(["admin"], "billing:close"), true);
  assert.equal(access.can(["ghost"], "orders:read"), false);
  assert.equal(access.can([], "orders:read"), false);

  assert.deepEqual(access.missing(["viewer"], ["orders:read", "orders:refund", "billing:read"]), ["orders:refund", "billing:read"]);
});

test("AccessControl: rejects duplicate roles, unknown parents and cycles", () => {
  assert.throws(() => createAccessControl([{ name: "a", permissions: [] }, { name: "a", permissions: [] }]), /Duplicate role "a"/);
  assert.throws(() => createAccessControl([{ name: "a", permissions: [], inherits: ["nope"] }]), /"a" inherits unknown role "nope"/);
  assert.throws(
    () => createAccessControl([
      { name: "a", permissions: [], inherits: ["b"] },
      { name: "b", permissions: [], inherits: ["a"] }
    ]),
    /cycle: a -> b -> a/
  );
});

function engineWith(ruleOptions) {
  const engine = createDecisionEngine({ name: "rbac-test" });
  engine.addRule(rbacRule({
    access: createAccessControl(ROLES),
    resolveRoles: ({ intent }) => ({ ann: ["viewer"], sam: ["support"], max: ["manager"] })[intent.actor] ?? [],
    ...ruleOptions
  }));
  return engine;
}

test("rbacRule: approves when roles grant the mapped permission, rejects with the missing list otherwise", async () => {
  const engine = engineWith({ permissions: { refund_order: "orders:refund", close_books: ["billing:close", "orders:read"] } });

  assert.equal((await engine.evaluate({ action: "refund_order", actor: "sam" })).result, "APPROVE");
  assert.equal((await engine.evaluate({ action: "refund_order", actor: "max" })).result, "APPROVE");

  const denied = await engine.evaluate({ action: "refund_order", actor: "ann" });
  assert.equal(denied.result, "REJECT");
  assert.equal(denied.code, "PERMISSION_DENIED");
  assert.equal(denied.rule, "rbac");
  assert.equal(denied.reason, 'Actor "ann" lacks permission(s): orders:refund.');

  const partial = await engine.evaluate({ action: "close_books", actor: "max" });
  assert.equal(partial.reason, 'Actor "max" lacks permission(s): billing:close.');
});

test("rbacRule: unmapped actions pass through unless denyUnmapped is set", async () => {
  assert.equal((await engineWith({ permissions: {} }).evaluate({ action: "ping", actor: "ann" })).result, "APPROVE");

  const strict = await engineWith({ permissions: {}, denyUnmapped: true }).evaluate({ action: "ping", actor: "ann" });
  assert.equal(strict.result, "REJECT");
  assert.equal(strict.code, "PERMISSION_DENIED");
});

test("rbacRule: inherited Object properties are not treated as mapped actions", async () => {
  const result = await engineWith({ permissions: {}, denyUnmapped: true }).evaluate({ action: "toString", actor: "max" });
  assert.equal(result.result, "REJECT");
  assert.match(result.reason, /no permission mapping/);
});

test("rbacRule: function mapping, async resolveRoles, and custom message/name", async () => {
  const engine = engineWith({
    name: "custom-rbac",
    message: "Nope.",
    permissions: ({ intent }) => (intent.action.startsWith("admin_") ? ["system:admin"] : undefined),
    resolveRoles: async () => ["manager"]
  });

  assert.equal((await engine.evaluate({ action: "view", actor: "x" })).result, "APPROVE");
  const denied = await engine.evaluate({ action: "admin_reset", actor: "x" });
  assert.equal(denied.result, "REJECT");
  assert.equal(denied.reason, "Nope.");
  assert.equal(denied.rule, "custom-rbac");
});
