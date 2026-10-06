/**
 * Account pages for a server `createAuth()` module.
 *
 * ```tsx
 * page("/login", () => <NexoLoginForm forgotPassword />, { layout: null }),
 * page("/reset-password", () => <NexoResetPasswordForm />, { layout: null }),
 * page("/verify-email", () => <NexoVerifyEmail />)
 * ```
 *
 * After signing in, `NexoLoginForm` goes to the `next` query parameter that
 * `NexoApp` adds when it redirects from a protected page (or to `redirectTo`).
 * The reset and verification pages read the `token` the emailed link carries.
 */

import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { errorsByField } from "@nexo-alpha/core/model";
import type { AuthUser } from "@nexo-alpha/core";
import { NexoApiError } from "../client.js";
import { useAuth } from "../auth-hooks.js";
import { useNexoClient } from "../context.js";
import { useNexoNavigate } from "../router/components.js";
import { NexoButton } from "./NexoButton.js";
import { NexoInput } from "./NexoInput.js";
import { NexoStack } from "./NexoLayout.js";
import { NexoErrorState, NexoLoader } from "./NexoFeedback.js";

export interface NexoLoginFormProps {
  /** Start on the sign-up form. Default: "login" */
  readonly mode?: "login" | "register" | undefined;
  /** Offer switching to sign-up (turn off when the server has `allowRegistration: false`). Default: true */
  readonly allowRegister?: boolean | undefined;
  /** Offer "Forgot password?" (the server needs `sendEmail`). Default: false */
  readonly forgotPassword?: boolean | undefined;
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

function queryParam(name: string): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name);
}

const formStyle = { maxWidth: "360px", margin: "48px auto" } as const;
const headingStyle = { margin: 0, fontSize: "1.5rem" } as const;
const noteStyle = { margin: 0, fontSize: "0.9rem", color: "var(--nexo-text-secondary, #94a3b8)" } as const;
const alertStyle = { fontSize: "0.85rem", color: "var(--nexo-danger, #ef4444)" } as const;

/** Field and form errors from a failed request, as the account forms show them. */
function readErrors(error: unknown): { byField: Record<string, string[]>; general: string | null } {
  const payload = error instanceof NexoApiError ? (error.payload as { errors?: unknown } | undefined) : undefined;
  if (Array.isArray(payload?.errors)) {
    const { "": general, ...byField } = errorsByField(payload.errors.map(String));
    return { byField, general: general?.join(" ") ?? null };
  }
  return { byField: {}, general: error instanceof Error ? error.message : String(error) };
}

type Mode = "login" | "register" | "forgot";

export function NexoLoginForm({
  mode: initialMode = "login",
  allowRegister = true,
  forgotPassword = false,
  redirectTo = "/",
  onSuccess
}: NexoLoginFormProps): React.JSX.Element {
  const auth = useAuth();
  const client = useNexoClient();
  const navigate = useNexoNavigate();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function switchTo(next: Mode): void {
    setMode(next);
    setErrors({});
    setFormError(null);
    setNotice(null);
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    try {
      if (mode === "forgot") {
        await client.auth.requestPasswordReset(email);
        // The same answer whether or not the account exists.
        setNotice("If an account exists for that email, a link to reset the password is on its way.");
        return;
      }
      const user = mode === "register"
        ? await auth.register({ email, password, ...(name !== "" ? { name } : {}) })
        : await auth.login(email, password);
      if (onSuccess) onSuccess(user);
      else navigate(safeRedirectPath(queryParam("next"), redirectTo));
    } catch (error) {
      const { byField, general } = readErrors(error);
      setErrors(byField);
      setFormError(general);
    } finally {
      setSubmitting(false);
    }
  }

  const title = mode === "register" ? "Create an account" : mode === "forgot" ? "Reset your password" : "Sign in";
  const action = mode === "register" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in";

  return (
    <form onSubmit={(event) => void submit(event)} noValidate style={formStyle}>
      <NexoStack gap={14}>
        <h1 style={headingStyle}>{title}</h1>
        {mode === "register" && (
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
        {mode !== "forgot" && (
          <NexoInput
            id="nexo-login-password"
            name="password"
            type="password"
            label="Password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password}
            error={errors.password?.join(" ")}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {formError && <div role="alert" style={alertStyle}>{formError}</div>}
        {notice && <p role="status" style={noteStyle}>{notice}</p>}
        <NexoButton type="submit" disabled={submitting}>
          {submitting ? "Please wait…" : action}
        </NexoButton>
        {mode === "login" && forgotPassword && (
          <NexoButton type="button" variant="ghost" onClick={() => switchTo("forgot")}>
            Forgot password?
          </NexoButton>
        )}
        {mode === "forgot" ? (
          <NexoButton type="button" variant="ghost" onClick={() => switchTo("login")}>
            Back to sign in
          </NexoButton>
        ) : allowRegister && (
          <NexoButton type="button" variant="ghost" onClick={() => switchTo(mode === "register" ? "login" : "register")}>
            {mode === "register" ? "I already have an account" : "Create an account"}
          </NexoButton>
        )}
      </NexoStack>
    </form>
  );
}

export interface NexoResetPasswordFormProps {
  /** Where to go once the new password is set (the user is then signed in). Default: "/" */
  readonly redirectTo?: string | undefined;
}

/** The page a password-reset email links to: reads `?token=`, asks for a new password, signs in. */
export function NexoResetPasswordForm({ redirectTo = "/" }: NexoResetPasswordFormProps): React.JSX.Element {
  const client = useNexoClient();
  const navigate = useNexoNavigate();
  const [token] = useState(() => queryParam("token"));
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (token === null) return <NexoErrorState title="Invalid link" error="This password-reset link is incomplete. Ask for a new one." />;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    try {
      await client.auth.resetPassword(token!, password);
      navigate(redirectTo);
    } catch (error) {
      const { byField, general } = readErrors(error);
      setErrors(byField);
      setFormError(general);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate style={formStyle}>
      <NexoStack gap={14}>
        <h1 style={headingStyle}>Choose a new password</h1>
        <NexoInput
          id="nexo-reset-password"
          name="password"
          type="password"
          label="New password"
          autoComplete="new-password"
          value={password}
          error={errors.password?.join(" ")}
          onChange={(e) => setPassword(e.target.value)}
        />
        {formError && <div role="alert" style={alertStyle}>{formError}</div>}
        <NexoButton type="submit" disabled={submitting}>
          {submitting ? "Please wait…" : "Set password"}
        </NexoButton>
      </NexoStack>
    </form>
  );
}

export interface NexoVerifyEmailProps {
  /** Shown after verifying, e.g. a link onward. */
  readonly children?: React.ReactNode;
}

/** The page a verification email links to: confirms `?token=` once and shows the result. */
export function NexoVerifyEmail({ children }: NexoVerifyEmailProps): React.JSX.Element {
  const client = useNexoClient();
  const [state, setState] = useState<{ status: "working" | "done" } | { status: "failed"; error: Error }>({ status: "working" });
  // The token works once; React may run effects twice in development.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = queryParam("token");
    if (token === null) {
      setState({ status: "failed", error: new Error("This verification link is incomplete.") });
      return;
    }
    client.auth.verifyEmail(token).then(
      () => setState({ status: "done" }),
      (error: unknown) => setState({ status: "failed", error: error instanceof Error ? error : new Error(String(error)) })
    );
  }, [client]);

  if (state.status === "working") return <NexoLoader label="Confirming your email address…" />;
  if (state.status === "failed") return <NexoErrorState title="Could not confirm your email" error={state.error} />;
  return (
    <div style={formStyle}>
      <NexoStack gap={12}>
        <h1 style={headingStyle}>Email confirmed</h1>
        <p style={noteStyle}>Thanks — your email address is verified.</p>
        {children}
      </NexoStack>
    </div>
  );
}
