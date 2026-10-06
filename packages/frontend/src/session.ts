/**
 * The signed-in session on the client: the token sent as
 * `Authorization: Bearer …` and the user it belongs to. Every NexoClient has
 * one (`client.session`); `client.auth.login()` fills it and `logout()` or
 * any 401 answer clears it.
 *
 * In browsers it is kept in localStorage so a reload stays signed in; pass
 * `storage: null` to keep it in memory only. A token in localStorage can be
 * read by any script on the page, so keep third-party scripts off pages that
 * use it.
 */

import type { AuthSession, AuthUser } from "@nexo-alpha/core";

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface NexoSessionOptions {
  /** Default: localStorage when available, otherwise memory only. `null`: memory only. */
  readonly storage?: SessionStorageLike | null | undefined;
  /** Storage key. Default: "nexo.session" */
  readonly key?: string | undefined;
}

function defaultStorage(): SessionStorageLike | null {
  try {
    const storage = (globalThis as { localStorage?: SessionStorageLike }).localStorage;
    return storage ?? null;
  } catch {
    // Access can throw (e.g. blocked site data).
    return null;
  }
}

const isLive = (session: AuthSession | null): session is AuthSession =>
  session !== null && Date.parse(session.expiresAt) > Date.now();

export class NexoSession {
  private state: AuthSession | null = null;
  private readonly storage: SessionStorageLike | null;
  private readonly key: string;
  private readonly listeners = new Set<() => void>();

  constructor(options: NexoSessionOptions = {}) {
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.key = options.key ?? "nexo.session";
    try {
      const saved = this.storage?.getItem(this.key);
      const parsed = saved ? (JSON.parse(saved) as AuthSession) : null;
      this.state = isLive(parsed) ? parsed : null;
    } catch {
      this.state = null;
    }
  }

  /** The current session, or null when signed out or expired. Stable between changes. */
  readonly get = (): AuthSession | null => (isLive(this.state) ? this.state : null);

  get token(): string | undefined {
    return this.get()?.token;
  }

  get user(): AuthUser | undefined {
    return this.get()?.user;
  }

  get signedIn(): boolean {
    return this.get() !== null;
  }

  set(session: AuthSession): void {
    this.update(session);
  }

  /** Replaces the user (e.g. after fetching it again), keeping the token. */
  setUser(user: AuthUser): void {
    if (this.state !== null) this.update({ ...this.state, user });
  }

  clear(): void {
    if (this.state !== null) this.update(null);
  }

  /** Called whenever the session changes. Returns an unsubscribe function. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(next: AuthSession | null): void {
    this.state = next;
    try {
      if (next === null) this.storage?.removeItem(this.key);
      else this.storage?.setItem(this.key, JSON.stringify(next));
    } catch {
      // Storage full or blocked: the session still works for this page.
    }
    for (const listener of [...this.listeners]) listener();
  }
}
