/**
 * @nexo-alpha/data — Nexo's data layer in one import.
 *
 * Everything here is implemented in `@nexo-alpha/core` and re-exported as
 * is: importing from either package gives the same functions and types, so
 * the two can be mixed freely. Browser code should import from
 * `@nexo-alpha/data/model` instead, which carries no Node.js code.
 */

// --- Models: one definition for types, validation, defaults and API schemas
export { model, field, errorsByField, humanize, SYSTEM_FIELDS } from "@nexo-alpha/core";
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
} from "@nexo-alpha/core";

// --- Resources: CRUD operations and their REST API
export {
  resource,
  RESOURCE_OPERATIONS,
  resourcePath,
  encodeListQuery,
  decodeListQuery,
  LIST_PARAMS
} from "@nexo-alpha/core";
export type {
  NexoResource,
  ResourceOptions,
  ResourceAuth,
  ResourceOperation,
  ResourceWriteInfo,
  ResourceChange,
  ResourceListQuery,
  ResourceListResult
} from "@nexo-alpha/core";

// --- Document stores, queries and multi-tenancy
export {
  createInMemoryDocumentStore,
  createFileDocumentStore,
  createSqliteDocumentStore,
  insertDocument,
  queryDocuments,
  scopeByProject,
  runInProject,
  currentProjectId
} from "@nexo-alpha/core";
export type {
  NexoDocumentStore,
  SqliteDocumentStoreOptions,
  DocumentQuery,
  DocumentQueryResult,
  DocumentScalar,
  ScopeByProjectOptions
} from "@nexo-alpha/core";

// --- File uploads
export {
  createFiles,
  createDiskBlobStore,
  createInMemoryBlobStore,
  FILES_PATH,
  mimeMatches
} from "@nexo-alpha/core";
export type {
  NexoFiles,
  NexoFile,
  NexoBlobStore,
  CreateFilesOptions,
  FilesCleanupOptions,
  UploadInput
} from "@nexo-alpha/core";

// --- Validation and errors the data layer reports
export { validateField, validateSchema, NexoValidationError, NexoHttpError } from "@nexo-alpha/core";
export type { NexoFieldSchema, NexoValidationOutcome } from "@nexo-alpha/core";
