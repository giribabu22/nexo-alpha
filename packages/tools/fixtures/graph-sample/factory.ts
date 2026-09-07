import { Widget } from "./models.js";

class Local {}

export function createWidget(): Widget {
  return new Widget();
}

export function createLocal(): Local {
  return new Local();
}
