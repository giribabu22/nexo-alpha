import { Widget } from "./models.js";

// The heuristic below is syntax-only: it never checks that the class
// actually declares the method being called on the instance.
class LocalThing {
  touch(): void {}
}

export function useWidgetInstance(): void {
  const w = new Widget();
  w.touch();
}

export function useLocalInstance(): void {
  const local = new LocalThing();
  local.touch();
}

export function ignoresLetInstance(): void {
  let maybeWidget = new Widget();
  maybeWidget.touch();
}

export function ignoresUntrackedObject(obj: { doThing: () => void }): void {
  obj.doThing();
}
