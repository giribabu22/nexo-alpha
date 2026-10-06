/**
 * Browser-environment tests (jsdom): components rendered with react-dom,
 * driven like a user, against a live server.
 */
import test from "node:test";
import assert from "node:assert/strict";

// The DOM must exist before react-dom loads, so everything else is imported after it.
const { React, render, waitFor, type, click, byText, window } = await import("../test-support/dom.js");
const core = await import("@nexo-alpha/core");
const { startHapiServer } = await import("@nexo-alpha/hapi");
const {
  createNexoClient,
  NexoApp,
  NexoForm,
  NexoLoginForm,
  NexoProvider,
  NexoResourceTable,
  NexoSession,
  page,
  useAuth
} = await import("../dist/index.js");

const h = React.createElement;

const Product = core.model("products", {
  name: core.field.string({ minLength: 1 }),
  price: core.field.number({ min: 0 }),
  category: core.field.enum(["tools", "toys"]).default("tools"),
  manual: core.field.file({ accept: ["application/pdf"] }).optional()
});

async function startServer({ withAuth = false } = {}) {
  const store = core.createInMemoryDocumentStore();
  const app = core.createApplication({ name: "dom-test" });
  const auth = core.createAuth({ store, secret: "dom-test-secret-0123456789abcdefghijklm" });
  if (withAuth) app.module(auth);
  app.module(core.createFiles({ store, blobs: core.createInMemoryBlobStore() }));
  app.module(core.resource(Product, { store, searchable: ["name"] }));
  const server = await startHapiServer(app, {
    port: 0,
    logging: false,
    bindLifecycle: false,
    ...(withAuth ? { authenticate: auth.authenticate } : {})
  });
  const client = createNexoClient({ baseUrl: server.info.uri, session: new NexoSession({ storage: null }) });
  return { server, client };
}

const input = (container, name) => container.querySelector(`[name="${name}"]`);

test("filling NexoForm creates a record and the table on the same page shows it", async (t) => {
  const { server, client } = await startServer();
  t.after(() => server.stop());
  const view = await render(
    h(NexoProvider, { client }, h(NexoForm, { model: Product, fields: ["name", "price", "category"] }), h(NexoResourceTable, { model: Product }))
  );
  t.after(() => view.unmount());

  await waitFor(() => byText(view.container, "No products yet"), { message: "empty table" });

  await type(input(view.container, "name"), "Hammer");
  await type(input(view.container, "price"), "12");
  await type(input(view.container, "category"), "toys");
  await click(byText(view.container, "Create", "button"));

  const cell = await waitFor(() => byText(view.container, "Hammer", "td"), { message: "new row in the table" });
  assert.ok(cell);
  assert.ok(byText(view.container, "toys", "td"));
  assert.equal(input(view.container, "name").value, "", "the form resets after saving");
  assert.equal((await client.resource(Product).list()).total, 1);
});

test("invalid input shows field errors and sends nothing", async (t) => {
  const { server, client } = await startServer();
  t.after(() => server.stop());
  const requests = [];
  const spying = createNexoClient({
    baseUrl: server.info.uri,
    session: new NexoSession({ storage: null }),
    fetch: (url, init) => { requests.push(init?.method ?? "GET"); return fetch(url, init); }
  });
  void client;
  const view = await render(h(NexoProvider, { client: spying }, h(NexoForm, { model: Product, fields: ["name", "price"] })));
  t.after(() => view.unmount());

  await type(input(view.container, "price"), "-5");
  await click(byText(view.container, "Create", "button"));

  await waitFor(() => byText(view.container, 'Field "body.name" is required.'), { message: "name error" });
  assert.ok(byText(view.container, "must be >= 0"));
  assert.equal(requests.filter((m) => m === "POST").length, 0);
});

test("delete asks first; cancelling keeps the row", async (t) => {
  const { server, client } = await startServer();
  t.after(() => server.stop());
  await client.resource(Product).create({ name: "Kite", price: 30 });
  const view = await render(h(NexoProvider, { client }, h(NexoResourceTable, { model: Product, allowDelete: true })));
  t.after(() => view.unmount());
  await waitFor(() => byText(view.container, "Kite", "td"), { message: "row" });

  const answers = [false, true];
  const asked = [];
  window.confirm = (question) => { asked.push(question); return answers.shift(); };

  await click(byText(view.container, "Delete", "button"));
  assert.equal(asked.length, 1);
  assert.equal((await client.resource(Product).list()).total, 1, "cancelled: still there");

  await click(byText(view.container, "Delete", "button"));
  await waitFor(() => byText(view.container, "No products yet"), { message: "empty after delete" });
  assert.equal((await client.resource(Product).list()).total, 0);
});

test("picking a file uploads it and the saved record references it", async (t) => {
  const { server, client } = await startServer();
  t.after(() => server.stop());
  let saved;
  const view = await render(
    h(NexoProvider, { client }, h(NexoForm, { model: Product, onSaved: (record) => { saved = record; } }))
  );
  t.after(() => view.unmount());

  const picker = view.container.querySelector('input[type="file"]');
  assert.equal(picker.getAttribute("accept"), "application/pdf");
  const pdf = new File(["%PDF-1.4"], "manual.pdf", { type: "application/pdf" });
  Object.defineProperty(picker, "files", { value: [pdf], configurable: true });
  await React.act(async () => { picker.dispatchEvent(new window.Event("change", { bubbles: true })); });
  // While uploading, the form cannot be submitted (it would save the record without the file).
  const button = view.container.querySelector('button[type="submit"]');
  await waitFor(() => button.textContent === "Uploading…" || byText(view.container, "manual.pdf"), { message: "upload started" });
  await type(input(view.container, "name"), "Drill");
  await type(input(view.container, "price"), "80");
  await click(button);
  await waitFor(() => button.textContent === "Create" && !button.disabled, { message: "upload finished" });
  if (saved === undefined) await click(button);
  await waitFor(() => saved, { message: "saved record" });

  const file = await client.files.info(saved.manual);
  assert.equal(file.name, "manual.pdf");
  assert.equal(file.attachedTo, `products/${saved.id}`);
});

test("a protected page sends you to sign in, then back where you were going", async (t) => {
  const { server, client } = await startServer({ withAuth: true });
  t.after(() => server.stop());
  window.history.replaceState({}, "", "/secret");

  function Secret() {
    const { user, logout } = useAuth();
    return h("div", null, h("h1", null, `Secret for ${user?.email}`), h("button", { onClick: () => void logout() }, "Sign out"));
  }
  const pages = [
    page("/secret", Secret, { protect: true }),
    page("/login", () => h(NexoLoginForm, { mode: "register" }), { layout: null })
  ];
  const view = await render(h(NexoApp, { pages, client }));
  t.after(() => view.unmount());

  await waitFor(() => window.location.pathname === "/login", { message: "redirect to /login" });
  assert.equal(window.location.search, "?next=%2Fsecret");
  await waitFor(() => byText(view.container, "Create an account"), { message: "sign-up form" });

  await type(input(view.container, "email"), "ann@example.com");
  await type(input(view.container, "password"), "correct horse");
  await click(byText(view.container, "Create account", "button"));

  await waitFor(() => byText(view.container, "Secret for ann@example.com"), { message: "the protected page" });
  assert.equal(window.location.pathname, "/secret");

  await click(byText(view.container, "Sign out", "button"));
  await waitFor(() => window.location.pathname === "/login", { message: "back to /login after signing out" });
  assert.equal(client.session.signedIn, false);
});
