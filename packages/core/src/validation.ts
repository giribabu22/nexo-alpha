import type {
  NexoApiSchema,
  NexoFieldSchema,
  NexoRequestContext,
  NexoRequestValidator,
  NexoValidationOutcome
} from "./api.js";
import { NexoValidationError } from "./errors.js";

/**
 * Checks whether a given schema is a {@link NexoApiSchema} (request shape)
 * rather than a {@link NexoFieldSchema} (single field descriptor).
 */
export function isApiSchema(schema: NexoFieldSchema | NexoApiSchema): schema is NexoApiSchema {
  return "params" in schema || "query" in schema || "body" in schema || "response" in schema;
}

/**
 * Validates a single value against a {@link NexoFieldSchema}.
 *
 * Supports nested objects, typed arrays, primitives, required flags,
 * ranges (min/max), length bounds (minLength/maxLength), regex patterns,
 * and enumerations without external dependencies.
 *
 * ```ts
 * const outcome = validateField(
 *   { type: "number", min: 1, max: 100, required: true },
 *   42,
 *   "quantity"
 * );
 * console.log(outcome.valid); // true
 * ```
 */
export function validateField(
  schema: NexoFieldSchema,
  value: unknown,
  fieldPath = "value"
): NexoValidationOutcome {
  const errors: string[] = [];

  // Check required / missing
  if (value === undefined || value === null) {
    if (schema.required === true) {
      errors.push(`Field "${fieldPath}" is required.`);
      return { valid: false, errors };
    }
    return { valid: true };
  }

  // Type checks and constraints
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") {
        errors.push(`Field "${fieldPath}" must be a string, got ${typeof value}.`);
        break;
      }

      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`Field "${fieldPath}" must have length >= ${schema.minLength}, got ${value.length}.`);
      }

      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`Field "${fieldPath}" must have length <= ${schema.maxLength}, got ${value.length}.`);
      }

      if (schema.pattern !== undefined) {
        const regex = typeof schema.pattern === "string" ? new RegExp(schema.pattern) : schema.pattern;
        if (!regex.test(value)) {
          errors.push(`Field "${fieldPath}" does not match required pattern.`);
        }
      }

      if (schema.enum !== undefined && !schema.enum.includes(value)) {
        errors.push(`Field "${fieldPath}" must be one of: [${schema.enum.join(", ")}], got "${value}".`);
      }
      break;
    }

    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        const received = typeof value === "number" ? "NaN" : typeof value;
        errors.push(`Field "${fieldPath}" must be a valid number, got ${received}.`);
        break;
      }

      if (schema.integer && !Number.isInteger(value)) {
        errors.push(`Field "${fieldPath}" must be an integer, got ${value}.`);
      }

      if (schema.min !== undefined && value < schema.min) {
        errors.push(`Field "${fieldPath}" must be >= ${schema.min}, got ${value}.`);
      }

      if (schema.max !== undefined && value > schema.max) {
        errors.push(`Field "${fieldPath}" must be <= ${schema.max}, got ${value}.`);
      }

      if (schema.enum !== undefined && !schema.enum.includes(value)) {
        errors.push(`Field "${fieldPath}" must be one of: [${schema.enum.join(", ")}], got ${value}.`);
      }
      break;
    }

    case "boolean": {
      if (typeof value !== "boolean") {
        errors.push(`Field "${fieldPath}" must be a boolean, got ${typeof value}.`);
        break;
      }

      if (schema.enum !== undefined && !schema.enum.includes(value)) {
        errors.push(`Field "${fieldPath}" must be one of: [${schema.enum.join(", ")}], got ${value}.`);
      }
      break;
    }

    case "array": {
      if (!Array.isArray(value)) {
        errors.push(`Field "${fieldPath}" must be an array, got ${typeof value}.`);
        break;
      }

      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`Field "${fieldPath}" must have at least ${schema.minLength} items, got ${value.length}.`);
      }

      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`Field "${fieldPath}" must have at most ${schema.maxLength} items, got ${value.length}.`);
      }

      if (schema.items !== undefined) {
        for (let i = 0; i < value.length; i++) {
          const itemOutcome = validateField(schema.items, value[i], `${fieldPath}[${i}]`);
          if (!itemOutcome.valid && itemOutcome.errors) {
            errors.push(...itemOutcome.errors);
          }
        }
      }
      break;
    }

    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        const received = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
        errors.push(`Field "${fieldPath}" must be an object, got ${received}.`);
        break;
      }

      const record = value as Record<string, unknown>;

      if (Array.isArray(schema.required)) {
        for (const reqKey of schema.required) {
          if (record[reqKey] === undefined || record[reqKey] === null) {
            errors.push(`Field "${fieldPath}.${reqKey}" is required.`);
          }
        }
      }

      if (schema.properties !== undefined) {
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          const propOutcome = validateField(propSchema, record[propName], `${fieldPath}.${propName}`);
          if (!propOutcome.valid && propOutcome.errors) {
            errors.push(...propOutcome.errors);
          }
        }
      }
      break;
    }

    default:
      break;
  }

  return {
    valid: errors.length === 0,
    ...(errors.length > 0 ? { errors } : {})
  };
}

/**
 * Validates arbitrary data against a {@link NexoFieldSchema} or an HTTP request
 * against a full {@link NexoApiSchema}.
 *
 * When validating a {@link NexoApiSchema}, accepts either a {@link NexoRequestContext}
 * or an object `{ params?, query?, body? }` (or `{ payload? }`), verifying
 * all declared parameters, query parameters, and payload fields.
 *
 * ```ts
 * const outcome = validateSchema(api.schema, requestContext);
 * if (!outcome.valid) {
 *   console.error(outcome.errors);
 * }
 * ```
 */
export function validateSchema(
  schema: NexoFieldSchema | NexoApiSchema,
  data: unknown
): NexoValidationOutcome {
  if (!isApiSchema(schema)) {
    return validateField(schema, data);
  }

  const errors: string[] = [];
  const req = (typeof data === "object" && data !== null ? data : {}) as {
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
    payload?: unknown;
    body?: unknown;
  };

  // Validate Path Params
  if (schema.params !== undefined) {
    const params = req.params ?? {};
    for (const [paramName, fieldSchema] of Object.entries(schema.params)) {
      const outcome = validateField(fieldSchema, params[paramName], `params.${paramName}`);
      if (!outcome.valid && outcome.errors) {
        errors.push(...outcome.errors);
      }
    }
  }

  // Validate Query Parameters
  if (schema.query !== undefined) {
    const query = req.query ?? {};
    for (const [queryName, fieldSchema] of Object.entries(schema.query)) {
      const outcome = validateField(fieldSchema, query[queryName], `query.${queryName}`);
      if (!outcome.valid && outcome.errors) {
        errors.push(...outcome.errors);
      }
    }
  }

  // Validate Body / Payload
  if (schema.body !== undefined) {
    const bodyValue = req.payload !== undefined ? req.payload : req.body;
    const outcome = validateField(schema.body, bodyValue, "body");
    if (!outcome.valid && outcome.errors) {
      errors.push(...outcome.errors);
    }
  }

  return {
    valid: errors.length === 0,
    ...(errors.length > 0 ? { errors } : {})
  };
}

/**
 * Creates a {@link NexoRequestValidator} from a {@link NexoApiSchema}.
 * Suitable for assignment to `NexoApi.validate`.
 *
 * ```ts
 * app.module({
 *   name: "users",
 *   apis: [
 *     {
 *       name: "createUser",
 *       method: "POST",
 *       path: "/users",
 *       schema: userApiSchema,
 *       validate: createSchemaValidator(userApiSchema),
 *       handler: async (ctx) => ...
 *     }
 *   ]
 * });
 * ```
 */
export function createSchemaValidator(schema: NexoApiSchema): NexoRequestValidator {
  return (context: NexoRequestContext): NexoValidationOutcome => {
    return validateSchema(schema, context);
  };
}

/**
 * Asserts that a {@link NexoValidationOutcome} is valid.
 * Throws a {@link NexoValidationError} if invalid.
 */
export function assertValid(outcome: NexoValidationOutcome, customMessage?: string): void {
  if (!outcome.valid) {
    const errors = outcome.errors ?? [];
    const message = customMessage ?? (errors.length > 0 ? errors.join("; ") : "Validation failed.");
    throw new NexoValidationError(message, errors);
  }
}
