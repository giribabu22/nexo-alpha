/**
 * The signed-in user in React. Re-renders when the session changes (sign-in,
 * sign-out, or a 401 from any request).
 *
 * ```tsx
 * const { user, signedIn, logout, hasScope } = useAuth();
 * return signedIn ? <button onClick={logout}>Sign out {user.email}</button> : <NexoLink to="/login">Sign in</NexoLink>;
 * ```
 */

import { useCallback, useSyncExternalStore } from "react";
import { scopeMatches } from "@nexo-alpha/core/model";
import type { AuthUser } from "@nexo-alpha/core";
import { useNexoClient } from "./context.js";
import type { NexoRegisterInput } from "./auth.js";

export interface UseAuthResult {
  readonly user: AuthUser | null;
  readonly signedIn: boolean;
  readonly login: (email: string, password: string) => Promise<AuthUser>;
  readonly register: (input: NexoRegisterInput) => Promise<AuthUser>;
  readonly logout: () => Promise<void>;
  /** Whether the user's scopes cover `scope` (wildcards like "notes:*" count). */
  readonly hasScope: (scope: string) => boolean;
}

export function useAuth(): UseAuthResult {
  const client = useNexoClient();
  const session = useSyncExternalStore(client.session.subscribe, client.session.get, client.session.get);
  const user = session?.user ?? null;
  const hasScope = useCallback(
    (scope: string) => (user?.scopes ?? []).some((granted) => scopeMatches(granted, scope)),
    [user]
  );
  return {
    user,
    signedIn: session !== null,
    login: client.auth.login,
    register: client.auth.register,
    logout: client.auth.logout,
    hasScope
  };
}
