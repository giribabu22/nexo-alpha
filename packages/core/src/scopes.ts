/** Scope matching, shared by the server and browser code. */

/**
 * Whether a granted scope covers a required one: identical, `"*"`, or a
 * `"prefix:*"` pattern whose prefix (including the colon) starts the
 * required scope — `"orders:*"` covers `"orders:refund"` but not `"orders"`.
 * `@nexo-alpha/decision`'s RBAC uses the same rule for permissions.
 */
export function scopeMatches(granted: string, required: string): boolean {
  if (granted === "*" || granted === required) return true;
  if (granted.endsWith(":*")) {
    return required.startsWith(granted.slice(0, -1));
  }
  return false;
}

/** The subset of `required` not covered by any of `granted`. */
export function missingScopes(granted: readonly string[] | undefined, required: readonly string[]): string[] {
  const grantedList = granted ?? [];
  return required.filter((scope) => !grantedList.some((g) => scopeMatches(g, scope)));
}
