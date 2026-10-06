import React, { useState, type FormEvent } from "react";
import { NexoApiError, NexoButton, NexoInput, createNexoClient, useNexoNavigate } from "@nexo-alpha/frontend";

const TOKEN_KEY = "token";

/** Every request sends the stored token. Pass to <NexoProvider client={client}>. */
export const client = createNexoClient({ auth: { token: () => localStorage.getItem(TOKEN_KEY) ?? "" } });

export function LoginPage(): React.JSX.Element {
  const navigate = useNexoNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      const { token } = await client.post<{ token: string }>("/api/auth/login", { email, password });
      localStorage.setItem(TOKEN_KEY, token);
      const next = new URLSearchParams(window.location.search).get("next");
      navigate(next !== null && /^\/(?![/\\])/.test(next) ? next : "/");
    } catch (caught) {
      setError(caught instanceof NexoApiError ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <h1>Sign in</h1>
      <NexoInput label="Email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <NexoInput
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error && <p role="alert">{error}</p>}
      <NexoButton type="submit" disabled={submitting}>
        Sign in
      </NexoButton>
    </form>
  );
}
