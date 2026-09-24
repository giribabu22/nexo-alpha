import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  nexoComp,
  defineNexoComp,
  NexoCard,
  NexoBadge,
  NexoMetric,
  NexoButton,
  NexoPage
} from "../dist/index.js";

test("nexoComp: defines a nexoComp with metadata and React in the background", () => {
  const UserProfileComp = nexoComp({
    name: "UserProfile",
    purpose: "Displays authenticated user info and access level",
    dependencies: ["system", "auth"],
    render: ({ username, role }) => {
      return React.createElement(
        "div",
        { className: "user-profile" },
        React.createElement("span", { className: "name" }, username),
        React.createElement("span", { className: "role" }, role)
      );
    }
  });

  assert.equal(UserProfileComp.isNexoComp, true);
  assert.equal(UserProfileComp.compName, "UserProfile");
  assert.equal(UserProfileComp.purpose, "Displays authenticated user info and access level");
  assert.deepEqual(UserProfileComp.dependencies, ["system", "auth"]);
  assert.equal(UserProfileComp.displayName, "NexoComp(UserProfile)");

  // Render via React in the background
  const html = renderToString(React.createElement(UserProfileComp, { username: "Alice", role: "Admin" }));
  assert.ok(html.includes("Alice"));
  assert.ok(html.includes("Admin"));
  assert.ok(html.includes("user-profile"));
});

test("nexoComp: supports shorthand signature (name, render)", () => {
  const GreetingComp = nexoComp("Greeting", ({ text }) => {
    return React.createElement("h1", null, text);
  });

  assert.equal(GreetingComp.isNexoComp, true);
  assert.equal(GreetingComp.compName, "Greeting");
  assert.equal(GreetingComp.displayName, "NexoComp(Greeting)");

  const html = renderToString(React.createElement(GreetingComp, { text: "Hello Nexo" }));
  assert.ok(html.includes("Hello Nexo"));
});

test("nexoComp: withProps creates pre-configured variations", () => {
  const AlertComp = nexoComp({
    name: "Alert",
    purpose: "Alert message banner",
    render: ({ message, variant = "info" }) => {
      return React.createElement("div", { className: `alert alert-${variant}` }, message);
    }
  });

  const ErrorAlertComp = AlertComp.withProps({ variant: "danger" });
  assert.equal(ErrorAlertComp.isNexoComp, true);
  assert.equal(ErrorAlertComp.compName, "Alert.preset");

  const html = renderToString(React.createElement(ErrorAlertComp, { message: "System failure" }));
  assert.ok(html.includes("alert-danger"));
  assert.ok(html.includes("System failure"));
});

test("nexoComp: built-in UI components are all genuine nexoComps", () => {
  assert.equal(NexoCard.isNexoComp, true);
  assert.equal(NexoCard.compName, "NexoCard");

  assert.equal(NexoBadge.isNexoComp, true);
  assert.equal(NexoBadge.compName, "NexoBadge");

  assert.equal(NexoMetric.isNexoComp, true);
  assert.equal(NexoMetric.compName, "NexoMetric");

  assert.equal(NexoButton.isNexoComp, true);
  assert.equal(NexoButton.compName, "NexoButton");

  assert.equal(NexoPage.isNexoComp, true);
  assert.equal(NexoPage.compName, "NexoPage");

  // Render a multi-nexoComp tree using React in the background
  const appTree = React.createElement(
    NexoPage,
    { title: "Dashboard" },
    React.createElement(
      NexoCard,
      { title: "Status" },
      React.createElement(NexoBadge, { variant: "success" }, "Active"),
      React.createElement(NexoMetric, { label: "Throughput", value: "99.9%" }),
      React.createElement(NexoButton, { variant: "primary" }, "Inspect")
    )
  );

  const html = renderToString(appTree);
  assert.ok(html.includes("Dashboard"));
  assert.ok(html.includes("Status"));
  assert.ok(html.includes("Active"));
  assert.ok(html.includes("Throughput"));
  assert.ok(html.includes("Inspect"));
});

test("nexoComp: LRU cache avoids redundant render evaluations", () => {
  let renderCount = 0;

  const CachedComp = nexoComp({
    name: "CachedComp",
    dsa: {
      lruCache: true,
      cacheKey: (props) => props.id
    },
    render: (props) => {
      renderCount++;
      return React.createElement("div", null, `Item-${props.id}`);
    }
  });

  // First call computes
  const html1 = renderToString(React.createElement(CachedComp, { id: "item-1" }));
  assert.equal(renderCount, 1);
  assert.ok(html1.includes("Item-item-1"));

  // Second call with same id uses LRU cache
  const html2 = renderToString(React.createElement(CachedComp, { id: "item-1" }));
  assert.equal(renderCount, 1);
  assert.equal(html1, html2);

  // Different id computes again
  const html3 = renderToString(React.createElement(CachedComp, { id: "item-2" }));
  assert.equal(renderCount, 2);
  assert.ok(html3.includes("Item-item-2"));
});
