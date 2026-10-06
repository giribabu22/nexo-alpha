/**
 * Declarative pages: one list of routes instead of router, provider and
 * layout wiring spread across files.
 *
 * ```tsx
 * const pages = [
 *   page("/", HomePage),
 *   page("/users", UsersPage),
 *   page("/users/:id", UserPage),                    // receives { params: { id } }
 *   page("/settings", SettingsPage, { protect: true }),  // signed-in users only
 *   page("/login", () => <NexoLoginForm />, { layout: null })
 * ];
 *
 * createRoot(el).render(<NexoApp pages={pages} layout={MainLayout} />);
 * ```
 *
 * Protected pages use the client's session (filled by `NexoLoginForm` /
 * `client.auth.login`), so a server `createAuth()` module is all it needs.
 * On start, a stored session is checked with the server once.
 */

import React, { useEffect, useMemo, type ComponentType, type ReactNode } from "react";
import { NexoProvider, useNexoClient } from "../context.js";
import { useAuth } from "../auth-hooks.js";
import type { NexoClient } from "../client.js";
import type { NexoAuthOptions } from "../types.js";
import { NexoEmptyState } from "../components/NexoFeedback.js";
import { createNexoRouter, type NexoRouter } from "./router.js";
import { NexoRouterProvider, useNexoNavigate, useNexoRoute } from "./components.js";

export interface NexoPageRouteProps {
  /** Path parameters, e.g. `{ id: "42" }` for `/users/:id` at `/users/42`. */
  readonly params: Readonly<Record<string, string>>;
}

export interface NexoPageOptions {
  /** Only for signed-in users; others are sent to the app's `loginPath`. Default: false */
  readonly protect?: boolean | undefined;
  /** Overrides the app layout for this page; `null` renders the page without one. */
  readonly layout?: ComponentType<{ readonly children: ReactNode }> | null | undefined;
}

export interface NexoPageRoute extends NexoPageOptions {
  readonly path: string;
  readonly component: ComponentType<NexoPageRouteProps>;
}

/** Declares a page: the component rendered at `path` (`:param` and trailing `*` are supported). */
export function page(path: string, component: ComponentType<NexoPageRouteProps>, options: NexoPageOptions = {}): NexoPageRoute {
  return { path, component, ...options };
}

export interface NexoAppProps {
  readonly pages: readonly NexoPageRoute[];
  /** Wraps every page (unless the page sets its own `layout`). */
  readonly layout?: ComponentType<{ readonly children: ReactNode }> | undefined;
  /** API client; or give `baseUrl`/`auth` to create one. */
  readonly client?: NexoClient | undefined;
  readonly baseUrl?: string | undefined;
  readonly auth?: NexoAuthOptions | undefined;
  /** Overrides the sign-in check for protected pages. Default: the client's session (see `useAuth`). */
  readonly isAuthenticated?: (() => boolean) | undefined;
  /** Where protected pages send signed-out users (with `?next=<path>`). Default: "/login" */
  readonly loginPath?: string | undefined;
  /** Rendered when no page matches. */
  readonly notFound?: ComponentType | undefined;
  /** Start path, for server rendering and tests. Default: the browser's location. */
  readonly initialPath?: string | undefined;
}

/** A complete app shell: API client, routing, layout and protected pages. */
export function NexoApp({
  pages,
  layout,
  client,
  baseUrl,
  auth,
  isAuthenticated,
  loginPath = "/login",
  notFound,
  initialPath
}: NexoAppProps): React.JSX.Element {
  const router = useMemo(
    () => createNexoRouter<NexoPageRoute>(pages.map((p) => ({ path: p.path, component: p }))),
    [pages]
  );

  return (
    <NexoProvider client={client} baseUrl={baseUrl} auth={auth}>
      {/* The router stores page routes rather than elements; NexoPages reads them back from the match. */}
      <NexoRouterProvider router={router as unknown as NexoRouter<ReactNode>} initialPath={initialPath}>
        <NexoPages layout={layout} isAuthenticated={isAuthenticated} loginPath={loginPath} notFound={notFound} />
      </NexoRouterProvider>
    </NexoProvider>
  );
}

function NexoPages({
  layout,
  isAuthenticated,
  loginPath,
  notFound: NotFound
}: Pick<NexoAppProps, "layout" | "isAuthenticated" | "notFound"> & { readonly loginPath: string }): React.JSX.Element | null {
  const match = useNexoRoute();
  const navigate = useNexoNavigate();
  const client = useNexoClient();
  const auth = useAuth();
  const route = match?.component as unknown as NexoPageRoute | undefined;
  const blocked = route?.protect === true && !(isAuthenticated ? isAuthenticated() : auth.signedIn);

  // A stored session may have ended on the server (signed out elsewhere, expired): check it once.
  useEffect(() => {
    void client.auth.me().catch(() => undefined);
  }, [client]);

  useEffect(() => {
    if (blocked && match) navigate(`${loginPath}?next=${encodeURIComponent(match.path)}`);
  }, [blocked, match, loginPath, navigate]);

  if (route === undefined || match === null) {
    return NotFound ? <NotFound /> : <NexoEmptyState title="Page not found" />;
  }
  if (blocked) return null;

  const Page = route.component;
  const Layout = route.layout === null ? undefined : (route.layout ?? layout);
  const content = <Page params={match.params} />;
  return Layout ? <Layout>{content}</Layout> : content;
}
