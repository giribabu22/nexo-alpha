import * as ns from "./ns-target.js";
import * as fs from "node:fs";

export function useNamespace(): number {
  return ns.double(21);
}

export function useExternalNamespace(): void {
  fs.readFileSync("x");
}
