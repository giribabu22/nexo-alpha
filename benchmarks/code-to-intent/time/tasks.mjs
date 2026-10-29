/**
 * Timed tasks (TIME-PROTOCOL.md). Each one is checked by the conformance test
 * the code-to-intent benchmark already uses, so "working" means the same
 * thing for every participant and both variants.
 *
 * - feature: the variant's files are replaced by stubs; build the feature
 *   until its conformance test passes.
 * - debug: the variant's working files, with one mistake put in; find it
 *   (record what you think the cause is), then fix it until the test passes.
 */

export const TASKS = {
  "user-crud": { kind: "feature", feature: "user-crud", tests: ["user CRUD", "pages render"] },
  "product-search": { kind: "feature", feature: "product-search", tests: ["search, filter and pagination", "pages render"] },
  relationship: { kind: "feature", feature: "relationship", tests: ["relationship: orders reference existing customers"] },
  authentication: { kind: "feature", feature: "authentication", tests: ["authentication: register, login, me, logout", "pages render"] },
  "file-upload": { kind: "feature", feature: "file-upload", tests: ["file upload and download"] },
  "app-startup": { kind: "feature", feature: "app-startup", tests: ["app startup: SQLite store, API on $PORT, records kept across a restart"] },

  "debug-wrong-scope": {
    kind: "debug",
    feature: "validated-post",
    tests: ["authenticated, validated POST"],
    // An authorization mistake: the write scope is misspelled.
    break: { file: "invitations.api.ts", find: '"invites:write"', replace: '"invite:write"' },
    cause: /scope|invites?:write/i
  },
  "debug-field-typo": {
    kind: "debug",
    feature: "user-crud",
    tests: ["user CRUD"],
    // A field name misspelled where the shape of a user is declared (schema before, model after).
    break: { file: { before: "user.ts", after: "user.model.ts" }, find: { before: "  email: { type", after: "  email: field" }, replace: { before: "  emial: { type", after: "  emial: field" } },
    cause: /emial|email/i
  }
};

export const VARIANTS = ["before", "after"];
