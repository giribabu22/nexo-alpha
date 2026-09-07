import { Gadget } from "./nested/gadget.js";
import { readFile } from "node:fs/promises";

export interface Widget {
  readonly id: string;
  readonly gadget?: Gadget;
}

export function createWidget(id: string): Widget {
  return { id };
}

export const DEFAULT_WIDGET_ID = "default";

const internalHelper = () => "not exported";

export { internalHelper as helper };

void readFile;
