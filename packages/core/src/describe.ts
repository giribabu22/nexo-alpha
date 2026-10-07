/**
 * Plain-JSON descriptions of models and schemas, for tooling and AI: what a
 * model's fields are (`describeModel`) and a JSON Schema for any
 * `NexoFieldSchema` (`toJsonSchema`), e.g. to give an LLM a tool's input
 * shape for function calling. No Node.js imports: browser-safe.
 */

import type { NexoFieldSchema } from "./api.js";
import type { FieldKind, FieldPresence, NexoField, NexoModel } from "./model.js";

/** One field of a model, as plain JSON. */
export interface FieldDescription {
  readonly kind: FieldKind;
  /** required: must be sent on create; optional: may be absent; defaulted: `default` is stored when omitted. */
  readonly presence: FieldPresence;
  readonly label: string;
  readonly description?: string;
  readonly default?: unknown;
  /** For `enum` fields: the allowed values. */
  readonly values?: readonly string[];
  /** For `ref` and `file` fields (and arrays of them): the referenced model, or "files". */
  readonly ref?: string;
  /** For `file` fields: allowed MIME types. */
  readonly accept?: readonly string[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
  /** A regular expression source, e.g. for `email` and `date` fields. */
  readonly pattern?: string;
  /** For `array` fields: each item. */
  readonly item?: FieldDescription;
}

/** A model as plain JSON. Every record also has `id`, `createdAt` and `updatedAt`. */
export interface ModelDescription {
  readonly name: string;
  readonly fields: Readonly<Record<string, FieldDescription>>;
}

function describeField(field: NexoField, label: string): FieldDescription {
  const { schema } = field;
  return {
    kind: field.kind,
    presence: field.presence,
    label,
    ...(schema.description !== undefined ? { description: schema.description } : {}),
    ...(field.presence === "defaulted" ? { default: field.defaultValue } : {}),
    ...(field.values !== undefined ? { values: field.values } : {}),
    ...(field.ref !== undefined ? { ref: field.ref } : {}),
    ...(field.accept !== undefined ? { accept: field.accept } : {}),
    ...(schema.minLength !== undefined ? { minLength: schema.minLength } : {}),
    ...(schema.maxLength !== undefined ? { maxLength: schema.maxLength } : {}),
    ...(schema.min !== undefined ? { min: schema.min } : {}),
    ...(schema.max !== undefined ? { max: schema.max } : {}),
    ...(schema.integer === true ? { integer: true } : {}),
    ...(schema.pattern !== undefined ? { pattern: patternSource(schema.pattern) } : {}),
    ...(field.item !== undefined ? { item: describeField(field.item, field.item.label ?? "") } : {})
  };
}

/** A model's fields as plain JSON, e.g. for `nexo inspect resource` or an AI's context. */
export function describeModel(model: NexoModel): ModelDescription {
  return {
    name: model.name,
    fields: Object.fromEntries(
      Object.entries(model.fields).map(([key, field]) => [key, describeField(field, model.label(key))])
    )
  };
}

/** A JSON Schema object (draft 2020-12 keywords). */
export type JsonSchema = { readonly [keyword: string]: unknown };

/**
 * Converts a `NexoFieldSchema` (e.g. `model.schema`, or a tool's `input`) to
 * a JSON Schema, the format LLM function calling expects. Required
 * properties come from both forms Nexo accepts: an object's
 * `required: ["a", "b"]` and a property's own `required: true`. A RegExp
 * `pattern` becomes its source (flags are dropped).
 */
export function toJsonSchema(schema: NexoFieldSchema): JsonSchema {
  const isInteger = schema.type === "number" && schema.integer === true;
  const isArray = schema.type === "array";
  const required = [
    ...(Array.isArray(schema.required) ? schema.required : []),
    ...Object.entries(schema.properties ?? {})
      .filter(([key, property]) => property.required === true && !(Array.isArray(schema.required) && schema.required.includes(key)))
      .map(([key]) => key)
  ];

  return {
    type: isInteger ? "integer" : schema.type,
    ...(schema.description !== undefined ? { description: schema.description } : {}),
    ...(schema.enum !== undefined ? { enum: schema.enum } : {}),
    ...(schema.minLength !== undefined ? { [isArray ? "minItems" : "minLength"]: schema.minLength } : {}),
    ...(schema.maxLength !== undefined ? { [isArray ? "maxItems" : "maxLength"]: schema.maxLength } : {}),
    ...(schema.min !== undefined ? { minimum: schema.min } : {}),
    ...(schema.max !== undefined ? { maximum: schema.max } : {}),
    ...(schema.pattern !== undefined ? { pattern: patternSource(schema.pattern) } : {}),
    ...(schema.items !== undefined ? { items: toJsonSchema(schema.items) } : {}),
    ...(schema.properties !== undefined
      ? {
          properties: Object.fromEntries(
            Object.entries(schema.properties).map(([key, property]) => [key, toJsonSchema(property)])
          )
        }
      : {}),
    ...(required.length > 0 ? { required } : {})
  };
}

function patternSource(pattern: string | RegExp): string {
  return typeof pattern === "string" ? pattern : pattern.source;
}
