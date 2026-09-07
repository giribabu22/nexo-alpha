import { greet } from "./service.js";
import { createHash } from "node:crypto";

export function run(name: string): string {
  createHash("sha256");
  return greet(name);
}
