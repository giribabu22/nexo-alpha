import test from "node:test";
import assert from "node:assert/strict";

import {
  resource,
  string,
  email,
  number,
  createResourceClient,
  createResourcesProxy,
  encodeListQuery
} from "../dist/index.js";

test("encodeListQuery builds URL search params", () => {
  const qs = encodeListQuery({
    limit: 10,
    cursor: "xyz123",
    sort: "name:asc",
    where: { role: "admin", active: true }
  });

  assert.match(qs, /limit=10/);
  assert.match(qs, /cursor=xyz123/);
  assert.match(qs, /sort=name%3Aasc/);
  assert.match(qs, /where%5Brole%5D=admin/);
  assert.match(qs, /where%5Bactive%5D=true/);
});

test("createResourceClient: calls caller methods with expected paths and payloads", async () => {
  const User = resource("User", {
    name: string(),
    email: email(),
    age: number().optional()
  });

  const calls = [];
  const fakeClient = {
    get: async (path) => {
      calls.push({ method: "GET", path });
      if (path.includes("usr_1")) {
        return { id: "usr_1", name: "Alice", email: "alice@example.com", createdAt: "2026-01-01", updatedAt: "2026-01-01" };
      }
      return { items: [], total: 0 };
    },
    post: async (path, body) => {
      calls.push({ method: "POST", path, body });
      return { id: "usr_2", ...body, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    },
    patch: async (path, body) => {
      calls.push({ method: "PATCH", path, body });
      return { id: "usr_1", name: "Alice", email: "alice@example.com", ...body, createdAt: "2026-01-01", updatedAt: "2026-01-02" };
    },
    delete: async (path) => {
      calls.push({ method: "DELETE", path });
    }
  };

  const client = createResourceClient(User, fakeClient);
  assert.equal(client.path, "/users");

  // List
  const page = await client.list({ limit: 5 });
  assert.deepEqual(page, { items: [], total: 0 });
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].path, "/users?limit=5");

  // Get
  const user = await client.get("usr_1");
  assert.equal(user.name, "Alice");
  assert.equal(calls[1].method, "GET");
  assert.equal(calls[1].path, "/users/usr_1");

  // Create
  const created = await client.create({ name: "Bob", email: "bob@example.com" });
  assert.equal(created.id, "usr_2");
  assert.equal(created.name, "Bob");
  assert.equal(calls[2].method, "POST");
  assert.equal(calls[2].path, "/users");
  assert.deepEqual(calls[2].body, { name: "Bob", email: "bob@example.com" });

  // Update
  const updated = await client.update("usr_1", { age: 30 });
  assert.equal(updated.age, 30);
  assert.equal(calls[3].method, "PATCH");
  assert.equal(calls[3].path, "/users/usr_1");
  assert.deepEqual(calls[3].body, { age: 30 });

  // Delete
  await client.delete("usr_1");
  assert.equal(calls[4].method, "DELETE");
  assert.equal(calls[4].path, "/users/usr_1");
});

test("createResourcesProxy: provides dynamic typed resource access", async () => {
  const User = resource("User", {
    name: string(),
    email: email()
  });

  const Order = resource("Order", {
    total: number()
  }, { path: "/custom-orders" });

  const calls = [];
  const fakeClient = {
    get: async (path) => {
      calls.push({ method: "GET", path });
      return { items: [], total: 0 };
    },
    post: async (path, body) => {
      calls.push({ method: "POST", path, body });
      return { id: "res_1", ...body };
    }
  };

  // With explicit resource registry map
  const apiWithMap = createResourcesProxy(fakeClient, {
    users: User,
    orders: Order
  });

  assert.equal(apiWithMap.users.path, "/users");
  assert.equal(apiWithMap.orders.path, "/custom-orders");

  await apiWithMap.users.list();
  assert.equal(calls[0].path, "/users");

  await apiWithMap.orders.create({ total: 100 });
  assert.equal(calls[1].path, "/custom-orders");

  // Generic proxy without map (converts property name to path)
  const apiGeneric = createResourcesProxy(fakeClient);
  assert.equal(apiGeneric.products.path, "/products");
  await apiGeneric.products.list();
  assert.equal(calls[2].path, "/products");
});
