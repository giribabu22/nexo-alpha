/**
 * Forms generated from a model.
 *
 * ```tsx
 * <NexoForm model={User} />                  // creates a user through the resource API
 * <NexoForm model={User} id={userId} />      // loads and edits an existing user
 * <NexoForm model={User} fields={["name", "email"]} onSubmit={invite} />
 * ```
 *
 * Inputs follow each field's kind (text, textarea, email, number, checkbox,
 * select, date). Values are validated with the model before submitting, and
 * validation errors from the server are shown next to their inputs.
 * `array` fields have no generated input: provide them through `initial` or
 * build a custom form with `useForm`.
 */

import React, { useCallback, useState, type CSSProperties, type FormEvent } from "react";
import {
  errorsByField,
  type FieldName,
  type Infer,
  type InferInput,
  type InferPatch,
  type NexoField,
  type NexoModel
} from "@nexo-alpha/core/model";
import { NexoApiError } from "../client.js";
import { useNexoClient } from "../context.js";
import { useRecord, useResourceClient } from "../resource-hooks.js";
import { NexoButton } from "./NexoButton.js";
import { NexoInput } from "./NexoInput.js";
import { NexoErrorState, NexoLoader } from "./NexoFeedback.js";

// ---------------------------------------------------------------------------
// useForm
// ---------------------------------------------------------------------------

export interface UseFormOptions<M extends NexoModel> {
  /** Starting values (e.g. the record being edited). */
  readonly initial?: Partial<Infer<M>> | Partial<InferInput<M>> | undefined;
  /** Receives the validated values. A thrown NexoApiError with `payload.errors` is shown on the fields. */
  readonly onSubmit: (values: InferInput<M>) => unknown | Promise<unknown>;
  /** Validate as an update (fields may be omitted; cleared optional fields are sent as null). Default: false */
  readonly partial?: boolean | undefined;
  /** Clear the form after a successful submit. Default: true unless `partial` */
  readonly resetOnSuccess?: boolean | undefined;
}

export interface UseFormResult {
  readonly values: Readonly<Record<string, unknown>>;
  /** Messages per field name; errors that name no field are in `formError`. */
  readonly errors: Readonly<Record<string, readonly string[]>>;
  readonly formError: string | null;
  readonly submitting: boolean;
  setValue(name: string, value: unknown): void;
  /** Validates and submits. Resolves true on success. */
  submit(event?: FormEvent): Promise<boolean>;
  reset(): void;
}

function pickFields(model: NexoModel, values: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(model.fields)) {
    if (values?.[key] !== undefined) picked[key] = values[key];
  }
  return picked;
}

/** Form state for a model: values, per-field errors and submit, without any markup. */
export function useForm<M extends NexoModel>(model: M, options: UseFormOptions<M>): UseFormResult {
  // The starting values are fixed when the form mounts (NexoForm remounts it when the edited record changes).
  const [initial] = useState(() => pickFields(model, options.initial as Record<string, unknown> | undefined));
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const partial = options.partial === true;
  const resetOnSuccess = options.resetOnSuccess ?? !partial;

  const showErrors = useCallback((messages: readonly string[]) => {
    const { "": general, ...byField } = errorsByField(messages);
    setErrors(byField);
    setFormError(general?.join(" ") ?? null);
  }, []);

  const setValue = useCallback((name: string, value: unknown) => {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (current[name] === undefined) return current;
      const { [name]: _cleared, ...rest } = current;
      return rest;
    });
  }, []);

  const submit = useCallback(
    async (event?: FormEvent): Promise<boolean> => {
      event?.preventDefault();
      const toSend: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined) toSend[key] = value;
        // On edit, an optional field the user emptied is cleared on the server.
        else if (partial && initial[key] !== undefined && model.fields[key]?.presence === "optional") toSend[key] = null;
      }

      const outcome = model.validate(toSend, { partial });
      if (!outcome.valid) {
        showErrors(outcome.errors ?? []);
        return false;
      }

      setSubmitting(true);
      try {
        await options.onSubmit(toSend as InferInput<M>);
        setErrors({});
        setFormError(null);
        if (resetOnSuccess) setValues(initial);
        return true;
      } catch (error) {
        const payload = error instanceof NexoApiError ? (error.payload as { errors?: unknown } | undefined) : undefined;
        if (Array.isArray(payload?.errors)) showErrors(payload.errors.map(String));
        else setFormError(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [values, initial, partial, resetOnSuccess, model, options.onSubmit, showErrors]
  );

  const reset = useCallback(() => {
    setValues(initial);
    setErrors({});
    setFormError(null);
  }, [initial]);

  return { values, errors, formError, submitting, setValue, submit, reset };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const controlStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255, 255, 255, 0.04)",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  borderRadius: "10px",
  padding: "10px 12px",
  color: "var(--nexo-text-primary, #f8fafc)",
  fontSize: "0.95rem",
  fontFamily: "inherit"
};
const labelStyle: CSSProperties = { fontSize: "0.85rem", fontWeight: 600, color: "var(--nexo-text-secondary, #94a3b8)" };
const errorStyle: CSSProperties = { fontSize: "0.75rem", color: "var(--nexo-danger, #ef4444)" };

interface FieldInputProps {
  readonly name: string;
  readonly label: string;
  readonly field: NexoField;
  readonly value: unknown;
  readonly error: string | undefined;
  readonly onChange: (value: unknown) => void;
}

/** A file picker that uploads on selection and stores the uploaded file's id. */
function FileInput({ name, label, field, value, error, onChange }: FieldInputProps): React.JSX.Element {
  const client = useNexoClient();
  const [status, setStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const id = `nexo-field-${name}`;

  async function choose(file: File | undefined): Promise<void> {
    setUploadError(null);
    if (file === undefined) return;
    setStatus(`Uploading ${file.name}…`);
    try {
      const uploaded = await client.files.upload(file);
      setStatus(uploaded.name);
      onChange(uploaded.id);
    } catch (caught) {
      setStatus(null);
      setUploadError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label htmlFor={id} style={labelStyle}>{field.presence === "required" ? `${label} *` : label}</label>
      <input
        id={id}
        name={name}
        type="file"
        {...(field.accept !== undefined ? { accept: field.accept.join(",") } : {})}
        onChange={(e) => void choose(e.target.files?.[0])}
        style={controlStyle}
      />
      {status !== null ? (
        <span style={{ fontSize: "0.8rem", color: "var(--nexo-text-secondary, #94a3b8)" }}>{status}</span>
      ) : typeof value === "string" ? (
        <a href={client.files.url(value)} target="_blank" rel="noreferrer" style={{ fontSize: "0.8rem" }}>Current file</a>
      ) : null}
      {(uploadError ?? error) && <span style={errorStyle}>{uploadError ?? error}</span>}
    </div>
  );
}

function FieldInput(props: FieldInputProps): React.JSX.Element | null {
  const { name, label, field, value, error, onChange } = props;
  if (field.kind === "file") return <FileInput {...props} />;
  const id = `nexo-field-${name}`;
  const shownLabel = field.presence === "required" ? `${label} *` : label;
  const text = (raw: string) => onChange(raw === "" ? undefined : raw);

  switch (field.kind) {
    case "boolean":
      return (
        <label htmlFor={id} style={{ ...labelStyle, display: "flex", alignItems: "center", gap: "8px" }}>
          <input id={id} name={name} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {shownLabel}
          {error && <span style={errorStyle}>{error}</span>}
        </label>
      );
    case "enum":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label htmlFor={id} style={labelStyle}>{shownLabel}</label>
          <select id={id} name={name} value={typeof value === "string" ? value : ""} onChange={(e) => text(e.target.value)} style={controlStyle}>
            {(field.presence !== "required" || value === undefined) && <option value="">—</option>}
            {(field.values ?? []).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          {error && <span style={errorStyle}>{error}</span>}
        </div>
      );
    case "text":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <label htmlFor={id} style={labelStyle}>{shownLabel}</label>
          <textarea id={id} name={name} rows={4} value={typeof value === "string" ? value : ""} onChange={(e) => text(e.target.value)} style={controlStyle} />
          {error && <span style={errorStyle}>{error}</span>}
        </div>
      );
    case "array":
      return null;
    default: {
      const type = field.kind === "number" ? "number" : field.kind === "email" ? "email" : field.kind === "date" ? "date" : "text";
      const shown = value === undefined || value === null ? "" : field.kind === "date" ? String(value).slice(0, 10) : String(value);
      return (
        <NexoInput
          id={id}
          name={name}
          type={type}
          label={shownLabel}
          value={shown}
          error={error}
          onChange={(e) => {
            const raw = e.target.value;
            if (field.kind === "number") onChange(raw === "" ? undefined : Number(raw));
            else text(raw);
          }}
        />
      );
    }
  }
}

// ---------------------------------------------------------------------------
// NexoForm
// ---------------------------------------------------------------------------

export interface NexoFormProps<M extends NexoModel> {
  readonly model: M;
  /** Edit this record (loaded through the resource API) instead of creating one. */
  readonly id?: string | undefined;
  /** Receives the validated values. Default: create the record, or update record `id`. */
  readonly onSubmit?: ((values: InferInput<M>) => unknown | Promise<unknown>) | undefined;
  /** Called with whatever the submit returned (the saved record, by default). */
  readonly onSaved?: ((result: unknown) => void) | undefined;
  readonly initial?: Partial<InferInput<M>> | undefined;
  /** Which fields to show, in order. Default: every field except arrays. */
  readonly fields?: readonly FieldName<M>[] | undefined;
  /** Default: "Create" or "Save" */
  readonly submitLabel?: string | undefined;
}

/** A form generated from a model that creates (or, with `id`, edits) a record. */
export function NexoForm<M extends NexoModel>(props: NexoFormProps<M>): React.JSX.Element {
  const record = useRecord(props.model, props.id);
  if (props.id !== undefined) {
    if (record.error) return <NexoErrorState error={record.error} onRetry={record.refetch} />;
    if (record.data === null) return <NexoLoader />;
  }
  // Remount when the loaded record changes, so the form starts from its new values.
  return <NexoFormFields key={record.data?.updatedAt ?? "new"} {...props} record={record.data} />;
}

function NexoFormFields<M extends NexoModel>({
  model,
  id,
  onSubmit,
  onSaved,
  initial,
  fields,
  submitLabel,
  record
}: NexoFormProps<M> & { readonly record: Infer<M> | null }): React.JSX.Element {
  const resource = useResourceClient(model);
  const editing = id !== undefined;
  const form = useForm(model, {
    initial: editing ? (record as Partial<Infer<M>>) : initial,
    partial: editing,
    onSubmit: async (values) => {
      const result = onSubmit !== undefined
        ? await onSubmit(values)
        : editing
          ? await resource.update(id, values as unknown as InferPatch<M>) // edit forms validate as a patch (partial)
          : await resource.create(values);
      onSaved?.(result);
    }
  });

  const shown = (fields ?? Object.keys(model.fields)).filter((key) => model.fields[key]?.kind !== "array");

  return (
    <form onSubmit={(event) => void form.submit(event)} noValidate style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {shown.map((key) => (
        <FieldInput
          key={key}
          name={key}
          label={model.label(key)}
          field={model.fields[key]!}
          value={form.values[key]}
          error={form.errors[key]?.join(" ")}
          onChange={(value) => form.setValue(key, value)}
        />
      ))}
      {form.formError && <div role="alert" style={errorStyle}>{form.formError}</div>}
      <div>
        <NexoButton type="submit" disabled={form.submitting}>
          {form.submitting ? "Saving…" : submitLabel ?? (editing ? "Save" : "Create")}
        </NexoButton>
      </div>
    </form>
  );
}
