/**
 * Sign-in and sign-up form for a server `createAuth()` module.
 *
 * ```tsx
 * page("/login", () => <NexoLoginForm />, { layout: null })
 * ```
 *
 * After signing in it goes to the `next` query parameter that `NexoApp` adds
 * when it redirects from a protected page (or to `redirectTo`).
 */

import React, { useState, type FormEvent } from "react";
import { errorsByField } from "@nexo-alpha/core/model";
import type { AuthUser } from "@nexo-alpha/core";
import { NexoApiError } from "../client.js";
import { useAuth } from "../auth-hooks.js";
import { useNexoNavigate } from "../router/components.js";
import { NexoButton } from "./NexoButton.js";
import { NexoInput } from "./NexoInput.js";
import { NexoStack } from "./NexoLayout.js";

export interface NexoLoginFormProps {
  /** Start on the sign-up form. Default: "login" */
  readonly mode?: "login" | "register" | undefined;
  /** Offer switching to sign-up (turn off when the server has `allowRegistration: false`). Default: true */
  readonly allowRegister?: boolean | undefined;
  /** Where to go after signing in when there is no `next` parameter. Default: "/" */
  readonly redirectTo?: string | undefined;
  /** Called after signing in, instead of navigating. */
  readonly onSuccess?: ((user: AuthUser) => void) | undefined;
}

/**
 * `next` if it is a path on this site, otherwise `fallback`, so a crafted
 * `?next=` link cannot send users to another site after they sign in.
 */
export function safeRedirectPath(next: string | null | undefined, fallback: string): string {
  // "//host" and "/\host" are protocol-relative URLs in browsers.
  return typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : fallback;
}

function nextPath(fallback: string): string {
  return safeRedirectPath(typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("next"), fallback);
}

export function NexoLoginForm({ mode = "login", allowRegister = true, redirectTo = "/", onSuccess }: NexoLoginFormProps): React.JSX.Element {
  const auth = useAuth();
  const navigate = useNexoNavigate();
  const [registering, setRegistering] = useState(mode === "register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    try {
      const user = registering
        ? await auth.register({ email, password, ...(name !== "" ? { name } : {}) })
        : await auth.login(email, password);
      if (onSuccess) onSuccess(user);
      else navigate(nextPath(redirectTo));
    } catch (error) {
      const payload = error instanceof NexoApiError ? (error.payload as { errors?: unknown } | undefined) : undefined;
      if (Array.isArray(payload?.errors)) {
        const { "": general, ...byField } = errorsByField(payload.errors.map(String));
        setErrors(byField);
        setFormError(general?.join(" ") ?? null);
      } else {
        setFormError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate style={{ maxWidth: "360px", margin: "48px auto" }}>
      <NexoStack gap={14}>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>{registering ? "Create an account" : "Sign in"}</h1>
        {registering && (
          <NexoInput id="nexo-login-name" name="name" label="Name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        )}
        <NexoInput
          id="nexo-login-email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          value={email}
          error={errors.email?.join(" ")}
          onChange={(e) => setEmail(e.target.value)}
        />
        <NexoInput
          id="nexo-login-password"
          name="password"
          type="password"
          label="Password"
          autoComplete={registering ? "new-password" : "current-password"}
          value={password}
          error={errors.password?.join(" ")}
          onChange={(e) => setPassword(e.target.value)}
        />
        {formError && (
          <div role="alert" style={{ fontSize: "0.85rem", color: "var(--nexo-danger, #ef4444)" }}>
            {formError}
          </div>
        )}
        <NexoButton type="submit" disabled={submitting}>
          {submitting ? "Please wait…" : registering ? "Create account" : "Sign in"}
        </NexoButton>
        {allowRegister && (
          <NexoButton type="button" variant="ghost" onClick={() => setRegistering(!registering)}>
            {registering ? "I already have an account" : "Create an account"}
          </NexoButton>
        )}
      </NexoStack>
    </form>
  );
}
