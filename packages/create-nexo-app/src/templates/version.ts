import { readFileSync } from "node:fs";

/**
 * The range generated projects install for every @nexo-alpha package. All
 * Nexo packages are released together, so it is this package's own version:
 * a project always gets the release its template was written for.
 */
export const NEXO_VERSION = `^${(JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version}`;
