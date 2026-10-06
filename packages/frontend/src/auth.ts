/**
 * Sign-in against a server `createAuth()` module. Reached as `client.auth`;
 * every successful call updates `client.session`, so later requests carry
 * the token automatically.
 *
 * ```ts
 * const user = await client.auth.login("ann@example.com", password);
 * await client.auth.logout();
 * ```
 */

import type { AuthSession, AuthUser } from "@nexo-alpha/core";
import { NexoApiError, type NexoClient } from "./client.js";

export interface NexoRegisterInput {
  readonly email: string;
  readonly password: string;
  readonly name?: string | undefined;
}

export class NexoAuthClient {
  private readonly client: NexoClient;
  readonly path: string;

  constructor(client: NexoClient, path = "/api/auth") {
    this.client = client;
    this.path = path.replace(/\/+$/, "");
  }

  /** Rejects with NexoApiError 401 for a wrong email or password, 429 after too many attempts. */
  readonly login = async (email: string, password: string): Promise<AuthUser> => {
    const session = await this.client.post<AuthSession>(`${this.path}/login`, { email, password });
    this.client.session.set(session);
    return session.user;
  };

  /** Rejects with NexoApiError 409 if the email is taken, 400 with `payload.errors` for invalid input. */
  readonly register = async (input: NexoRegisterInput): Promise<AuthUser> => {
    const session = await this.client.post<AuthSession>(`${this.path}/register`, input);
    this.client.session.set(session);
    return session.user;
  };

  /** Ends the session on the server and forgets it here. Always signs out locally. */
  readonly logout = async (): Promise<void> => {
    if (!this.client.session.signedIn) return;
    try {
      await this.client.post(`${this.path}/logout`);
    } catch (error) {
      if (!(error instanceof NexoApiError && error.status === 401)) throw error;
    } finally {
      this.client.session.clear();
    }
  };

  /** Fetches the signed-in user again (fresh scopes); null when signed out or the session ended. */
  readonly me = async (): Promise<AuthUser | null> => {
    if (!this.client.session.signedIn) return null;
    try {
      const { user } = await this.client.get<{ user: AuthUser }>(`${this.path}/me`);
      this.client.session.setUser(user);
      return user;
    } catch (error) {
      if (error instanceof NexoApiError && error.status === 401) return null;
      throw error;
    }
  };
}
