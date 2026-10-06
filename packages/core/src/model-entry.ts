/**
 * Browser-safe entry point: `import { model, field } from "@nexo-alpha/core/model"`.
 *
 * Model files import from here so the frontend can share them with the
 * server (types, client-side validation, form and table rendering) without
 * bundling Node.js code. Everything here is also exported from
 * `@nexo-alpha/core`.
 */

export { model, field, errorsByField, humanize, SYSTEM_FIELDS } from "./model.js";
export type {
  NexoModel,
  NexoField,
  NexoFields,
  NexoRecordBase,
  FieldKind,
  FieldPresence,
  FieldName,
  Infer,
  InferInput,
  InferPatch,
  StringFieldOptions,
  NumberFieldOptions,
  ValidateOptions
} from "./model.js";

export { FILES_PATH, mimeMatches } from "./files-contract.js";
export type { NexoFile } from "./files-contract.js";

export { resourcePath, encodeListQuery, decodeListQuery, LIST_PARAMS } from "./resource-contract.js";
export type { ResourceListQuery, ResourceListResult } from "./resource-contract.js";

export { validateField } from "./validation.js";
export { scopeMatches, missingScopes } from "./scopes.js";
export { NexoError, NexoValidationError, NexoHttpError } from "./errors.js";
export type { NexoFieldSchema, NexoValidationOutcome } from "./api.js";
