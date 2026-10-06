/**
 * A browser-like environment for React tests: a jsdom window as the global
 * DOM, plus helpers that act like a user (type, click) and wait for the UI.
 *
 * Import it before anything that loads react-dom. It lives outside test/ so
 * `node --test` does not run it as a test file.
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
const { window } = dom;

// What react-dom and the components read; fetch, Blob and File stay Node's own.
for (const key of [
  "window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement",
  "HTMLTextAreaElement", "HTMLFormElement", "Node", "Event", "MouseEvent", "KeyboardEvent",
  "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver", "location", "history"
]) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");

export { window, React, act };

/** Renders `element` into a fresh container. Call `unmount()` when done. */
export async function render(element) {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    }
  };
}

/** Waits until `check()` returns something truthy (or stops throwing), letting React update in between. */
export async function waitFor(check, { timeout = 3000, message = "condition" } = {}) {
  const started = Date.now();
  let lastError;
  for (;;) {
    try {
      const result = check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() - started > timeout) {
      throw new Error(`Timed out waiting for ${message}${lastError ? `: ${lastError.message}` : ""}`);
    }
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  }
}

/** Types into an input, textarea or select the way React expects (native setter + event). */
export async function type(element, value) {
  const prototype = element.tagName === "SELECT"
    ? window.HTMLSelectElement.prototype
    : element.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
  await act(async () => {
    element.dispatchEvent(new window.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

export async function click(element) {
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

/** The first element whose text includes `text` (optionally within `selector` matches). */
export function byText(container, text, selector = "*") {
  return [...container.querySelectorAll(selector)].find((el) => el.textContent?.includes(text) && el.children.length === 0)
    ?? [...container.querySelectorAll(selector)].find((el) => el.textContent?.includes(text));
}
