/**
 * Models: one declaration of a domain object that drives its TypeScript
 * types, validation, defaults and API schema — on the server and in the
 * browser (this file has no Node.js imports; see `@nexo-alpha/core/model`).
 *
 * ```ts
 * export const User = model("users", {
 *   name: field.string({ minLength: 1 }),
 *   email: field.email(),
 *   role: field.enum(["member", "admin"]).default("member"),
 *   age: field.number({ min: 0 }).optional()
 * });
 * export type User = Infer<typeof User>; // { id, createdAt, updatedAt, name, email, role, age? }
 * ```
 *
 * Every record also has `id`, `createdAt` and `updatedAt`, managed by
 * `resource()`. Fields not declared on the model are rejected, so a typo like
 * `emial` fails validation instead of being silently stored.
 */

import type { NexoFieldSchema, NexoValidationOutcome } from "./api.js";
import { validateField } from "./validation.js";
import { NexoConfigurationError, NexoValidationError } from "./errors.js";

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/**
 * Whether a field must be sent when creating a record:
 * - `required`: must be sent; always present on records.
 * - `optional`: may be omitted; may be absent on records.
 * - `defaulted`: may be omitted (the default is stored); always present on records.
 */
export type FieldPresence = "required" | "optional" | "defaulted";

/** What a field holds, which also decides how forms and tables render it. */
export type FieldKind = "string" | "text" | "email" | "number" | "boolean" | "enum" | "date" | "ref" | "file" | "array";

export interface NexoField<T = unknown, P extends FieldPresence = FieldPresence> {
  readonly kind: FieldKind;
  /** The validation schema for one value (without `required`, which `presence` decides). */
  readonly schema: NexoFieldSchema;
  readonly presence: P;
  readonly defaultValue?: T;
  /** For `ref` fields (and arrays of refs): the referenced model's name. */
  readonly ref?: string;
  /** For `enum` fields: the allowed values. */
  readonly values?: readonly string[];
  /** For `file` fields: allowed MIME types, e.g. ["image/*", "application/pdf"]. */
  readonly accept?: readonly string[];
  /** Human-readable name for forms and tables. Default: derived from the key. */
  readonly label?: string;
  /** For `array` fields: the item field. */
  readonly item?: NexoField;
  /** Type-only marker; never set at runtime. */
  readonly __type?: T;

  /** May be omitted; may be absent on records. */
  optional(): NexoField<T, "optional">;
  /** May be omitted; `value` is stored instead. */
  default(value: T): NexoField<T, "defaulted">;
  /** Sets the label shown in forms and tables. */
  labelled(label: string): NexoField<T, P>;
  /** Explains the field; included in the API schema (for docs and AI tooling). */
  describe(description: string): NexoField<T, P>;
}

interface FieldSpec {
  readonly kind: FieldKind;
  readonly schema: NexoFieldSchema;
  readonly presence: FieldPresence;
  readonly defaultValue?: unknown;
  readonly ref?: string;
  readonly values?: readonly string[];
  readonly accept?: readonly string[];
  readonly label?: string;
  readonly item?: NexoField;
}

function makeField<T, P extends FieldPresence>(spec: FieldSpec): NexoField<T, P> {
  return {
    ...spec,
    optional: () => makeField<T, "optional">({ ...spec, presence: "optional" }),
    default: (value: T) => makeField<T, "defaulted">({ ...spec, presence: "defaulted", defaultValue: value }),
    labelled: (label: string) => makeField<T, P>({ ...spec, label }),
    describe: (description: string) => makeField<T, P>({ ...spec, schema: { ...spec.schema, description } })
  } as NexoField<T, P>;
}

export interface StringFieldOptions {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string | RegExp;
}

export interface NumberFieldOptions {
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function defined<T extends object>(options: T): Partial<T> {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) as Partial<T>;
}

/** Field builders. Every field is required unless `.optional()` or `.default(…)` is called. */
export const field = {
  /** A single-line string. */
  string(options: StringFieldOptions = {}): NexoField<string, "required"> {
    return makeField({ kind: "string", schema: { type: "string", ...defined(options) }, presence: "required" });
  },
  /** A multi-line string (rendered as a textarea). */
  text(options: StringFieldOptions = {}): NexoField<string, "required"> {
    return makeField({ kind: "text", schema: { type: "string", ...defined(options) }, presence: "required" });
  },
  /** An email address. */
  email(): NexoField<string, "required"> {
    return makeField({ kind: "email", schema: { type: "string", maxLength: 254, pattern: EMAIL_PATTERN }, presence: "required" });
  },
  number(options: NumberFieldOptions = {}): NexoField<number, "required"> {
    return makeField({ kind: "number", schema: { type: "number", ...defined(options) }, presence: "required" });
  },
  boolean(): NexoField<boolean, "required"> {
    return makeField({ kind: "boolean", schema: { type: "boolean" }, presence: "required" });
  },
  /** One of a fixed list of strings: `field.enum(["low", "high"])`. */
  enum<const V extends readonly [string, ...string[]]>(values: V): NexoField<V[number], "required"> {
    return makeField({ kind: "enum", schema: { type: "string", enum: values }, presence: "required", values });
  },
  /** An ISO 8601 date or date-time string, e.g. "2026-10-06" or "2026-10-06T12:00:00Z". */
  date(): NexoField<string, "required"> {
    return makeField({ kind: "date", schema: { type: "string", pattern: ISO_DATE_PATTERN }, presence: "required" });
  },
  /** The id of a record of another model, e.g. `field.ref("customers")`. `resource()` checks that it exists. */
  ref(modelName: string): NexoField<string, "required"> {
    return makeField({ kind: "ref", schema: { type: "string", minLength: 1 }, presence: "required", ref: modelName });
  },
  /**
   * An uploaded file (see `createFiles`): stores the file's id. `resource()`
   * checks the file exists and, with `accept`, that its type is allowed.
   * Forms show a file picker that uploads on selection.
   */
  file(options: { readonly accept?: readonly string[] } = {}): NexoField<string, "required"> {
    return makeField({
      kind: "file",
      schema: { type: "string", minLength: 1 },
      presence: "required",
      ref: "files",
      ...(options.accept !== undefined ? { accept: options.accept } : {})
    });
  },
  /** A list of values: `field.array(field.string())`, `field.array(field.ref("tags"))`. */
  array<T>(item: NexoField<T, FieldPresence>): NexoField<T[], "required"> {
    return makeField({
      kind: "array",
      schema: { type: "array", items: item.schema },
      presence: "required",
      item,
      ...(item.ref !== undefined ? { ref: item.ref } : {})
    });
  }
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NexoFields = Readonly<Record<string, NexoField<any, FieldPresence>>>;

/** Fields every stored record has, managed by `resource()`. */
export interface NexoRecordBase {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type ValueOf<F> = F extends NexoField<infer T, FieldPresence> ? T : never;
type KeysWithPresence<F extends NexoFields, P extends FieldPresence> = {
  [K in keyof F]: F[K]["presence"] extends P ? K : never;
}[keyof F];
type FieldsOf<M> = M extends NexoModel<infer F> ? F : never;

/** A stored record: `type User = Infer<typeof User>`. */
export type Infer<M extends NexoModel> = Simplify<
  NexoRecordBase &
  { [K in KeysWithPresence<FieldsOf<M>, "required" | "defaulted">]: ValueOf<FieldsOf<M>[K]> } &
  { [K in KeysWithPresence<FieldsOf<M>, "optional">]?: ValueOf<FieldsOf<M>[K]> }
>;

/** What `create()` accepts: required fields must be present; optional and defaulted ones may be omitted. */
export type InferInput<M extends NexoModel> = Simplify<
  { [K in KeysWithPresence<FieldsOf<M>, "required">]: ValueOf<FieldsOf<M>[K]> } &
  { [K in KeysWithPresence<FieldsOf<M>, "optional" | "defaulted">]?: ValueOf<FieldsOf<M>[K]> | undefined }
>;

/** What `update()` accepts: any subset of fields; `null` clears an optional field. */
export type InferPatch<M extends NexoModel> = Simplify<
  { [K in KeysWithPresence<FieldsOf<M>, "required" | "defaulted">]?: ValueOf<FieldsOf<M>[K]> | undefined } &
  { [K in KeysWithPresence<FieldsOf<M>, "optional">]?: ValueOf<FieldsOf<M>[K]> | null | undefined }
>;

/** The name of one of a model's declared fields. */
export type FieldName<M extends NexoModel> = keyof FieldsOf<M> & string;

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export interface ValidateOptions {
  /** Validate as an update: every field may be omitted. Default: false */
  readonly partial?: boolean;
}

export interface NexoModel<F extends NexoFields = NexoFields> {
  /** Lowercase, plural, kebab-case: the collection name and the default API path (`/api/<name>`). */
  readonly name: string;
  readonly fields: F;
  /** Request-body schema for creating a record. */
  readonly schema: NexoFieldSchema;
  /** Request-body schema for updating a record (every field optional). */
  readonly patchSchema: NexoFieldSchema;
  /** Schema of a stored record, including `id`, `createdAt` and `updatedAt`. */
  readonly recordSchema: NexoFieldSchema;
  /** Checks input without throwing. Error messages name fields as `body.<field>`. */
  validate(input: unknown, options?: ValidateOptions): NexoValidationOutcome;
  /** Validates create input and returns only the declared fields, with defaults applied. Throws NexoValidationError. */
  parse(input: unknown): Record<string, unknown>;
  /** Validates update input and returns only the declared fields that were sent (`null` means clear). Throws NexoValidationError. */
  parsePatch(input: unknown): Record<string, unknown>;
  /** Fills defaults missing from a stored document, e.g. for a field added after it was written. */
  hydrate(document: unknown): NexoRecordBase & Record<string, unknown>;
  /** The label of a field (its `labelled()` value, or one derived from the key). */
  label(fieldName: string): string;
}

/** Field names `resource()` manages; sending them to `create`/`update` is allowed and ignored. */
export const SYSTEM_FIELDS: readonly string[] = ["id", "createdAt", "updatedAt"];

const MODEL_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** "createdAt" → "Created at", "customer_id" → "Customer id". */
export function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function copy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * Declares a model. `name` is lowercase and plural (`"users"`, `"order-items"`):
 * it is the collection the records are stored in and the default API path.
 */
export function model<const F extends NexoFields>(name: string, fields: F): NexoModel<F> {
  if (!MODEL_NAME.test(name)) {
    throw new NexoConfigurationError(
      `Invalid model name "${name}": use lowercase kebab-case, usually plural (e.g. "users", "order-items").`
    );
  }
  for (const key of Object.keys(fields)) {
    if (SYSTEM_FIELDS.includes(key)) {
      throw new NexoConfigurationError(`Model "${name}" declares "${key}", which every record already has.`);
    }
    if (!FIELD_NAME.test(key)) {
      throw new NexoConfigurationError(`Model "${name}" has an invalid field name "${key}".`);
    }
  }

  const entries = Object.entries(fields);
  const properties = Object.fromEntries(entries.map(([key, f]) => [key, f.schema]));
  const requiredKeys = entries.filter(([, f]) => f.presence === "required").map(([key]) => key);

  const schema: NexoFieldSchema = { type: "object", properties, required: requiredKeys };
  const patchSchema: NexoFieldSchema = { type: "object", properties };
  const recordSchema: NexoFieldSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      ...properties,
      createdAt: { type: "string" },
      updatedAt: { type: "string" }
    },
    required: ["id", ...entries.filter(([, f]) => f.presence !== "optional").map(([key]) => key), "createdAt", "updatedAt"]
  };

  function check(input: unknown, partial: boolean): string[] {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return [`Field "body" must be an object.`];
    }
    const record = input as Record<string, unknown>;
    const errors: string[] = [];

    for (const key of Object.keys(record)) {
      if (!(key in fields) && !SYSTEM_FIELDS.includes(key)) {
        errors.push(`Field "body.${key}" is not a field of model "${name}".`);
      }
    }

    for (const [key, f] of entries) {
      const value = record[key];
      if (value === undefined || value === null) {
        if (!partial && f.presence === "required") errors.push(`Field "body.${key}" is required.`);
        if (partial && value === null && f.presence !== "optional") errors.push(`Field "body.${key}" cannot be cleared.`);
        continue;
      }
      const outcome = validateField(f.schema, value, `body.${key}`);
      if (!outcome.valid) errors.push(...(outcome.errors ?? []));
      else if (f.kind === "date" && Number.isNaN(Date.parse(value as string))) {
        errors.push(`Field "body.${key}" is not a valid date.`);
      }
    }
    return errors;
  }

  function assertChecked(input: unknown, partial: boolean): Record<string, unknown> {
    const errors = check(input, partial);
    if (errors.length > 0) {
      throw new NexoValidationError(`Invalid ${name}: ${errors.join("; ")}`, errors);
    }
    return input as Record<string, unknown>;
  }

  return {
    name,
    fields,
    schema,
    patchSchema,
    recordSchema,

    validate(input, options = {}) {
      const errors = check(input, options.partial === true);
      return errors.length === 0 ? { valid: true } : { valid: false, errors };
    },

    parse(input) {
      const record = assertChecked(input, false);
      const values: Record<string, unknown> = {};
      for (const [key, f] of entries) {
        const value = record[key];
        if (value !== undefined && value !== null) values[key] = copy(value);
        else if (f.presence === "defaulted") values[key] = copy(f.defaultValue);
      }
      return values;
    },

    parsePatch(input) {
      const record = assertChecked(input, true);
      const values: Record<string, unknown> = {};
      for (const [key] of entries) {
        if (record[key] !== undefined) values[key] = copy(record[key]);
      }
      return values;
    },

    hydrate(document) {
      const record = { ...(document as Record<string, unknown>) };
      for (const [key, f] of entries) {
        if (record[key] === undefined && f.presence === "defaulted") record[key] = copy(f.defaultValue);
      }
      return record as NexoRecordBase & Record<string, unknown>;
    },

    label(fieldName) {
      return fields[fieldName]?.label ?? humanize(fieldName);
    }
  };
}

/**
 * Groups validation messages (`Field "body.email" is required.`) by the
 * top-level field they name, so a form can show each one next to its input.
 * Messages that name no field are grouped under `""`.
 */
export function errorsByField(errors: readonly string[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const message of errors) {
    const key = /^Field "(?:body|query)\.([A-Za-z0-9_]+)/.exec(message)?.[1] ?? "";
    (grouped[key] ??= []).push(message);
  }
  return grouped;
}
