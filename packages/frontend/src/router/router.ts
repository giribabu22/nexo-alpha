import { NexoRadixTrie, type RouteMatchResult } from "../dsa/trie.js";
import { NexoLruCache } from "../dsa/lru.js";

export interface RouteDefinition<TComponent = any, TMeta = Record<string, unknown>> {
  readonly path: string;
  readonly component: TComponent;
  readonly meta?: TMeta | undefined;
}

export interface MatchedRoute<TComponent = any, TMeta = Record<string, unknown>> {
  readonly path: string;
  readonly fullPath: string;
  readonly params: Readonly<Record<string, string>>;
  readonly component: TComponent;
  readonly meta?: TMeta | undefined;
}

export type NavigationListener<TComponent = any, TMeta = any> = (route: MatchedRoute<TComponent, TMeta> | null) => void;

export class NexoRouter<TComponent = any, TMeta = Record<string, unknown>> {
  private readonly trie = new NexoRadixTrie<RouteDefinition<TComponent, TMeta>>();
  private readonly matchCache = new NexoLruCache<string, MatchedRoute<TComponent, TMeta>>(200);
  private currentPath = "/";
  private currentMatch: MatchedRoute<TComponent, TMeta> | null = null;
  private readonly listeners = new Set<NavigationListener<TComponent, TMeta>>();

  constructor(routes: readonly RouteDefinition<TComponent, TMeta>[] = []) {
    for (const r of routes) {
      this.register(r.path, r.component, r.meta);
    }
  }

  register(path: string, component: TComponent, meta?: TMeta): this {
    this.trie.insert(path, { path, component, meta });
    this.matchCache.clear(); // invalidate cache on new route registration
    return this;
  }

  match(urlPath: string): MatchedRoute<TComponent, TMeta> | null {
    const cleanPath = urlPath.split("?")[0]?.trim() || "/";

    // $O(1)$ LRU Cache lookup
    const cached = this.matchCache.get(cleanPath);
    if (cached) {
      return cached;
    }

    // $O(k)$ Radix Trie traversal
    const result = this.trie.match(cleanPath);
    if (!result) {
      return null;
    }

    const matched: MatchedRoute<TComponent, TMeta> = {
      path: cleanPath,
      fullPath: result.path,
      params: result.params,
      component: result.route.component,
      meta: result.route.meta
    };

    this.matchCache.set(cleanPath, matched);
    return matched;
  }

  navigate(urlPath: string): boolean {
    const match = this.match(urlPath);
    this.currentPath = urlPath;
    this.currentMatch = match;

    for (const listener of this.listeners) {
      listener(match);
    }

    return match !== null;
  }

  getCurrentPath(): string {
    return this.currentPath;
  }

  getCurrentMatch(): MatchedRoute<TComponent, TMeta> | null {
    if (!this.currentMatch) {
      this.currentMatch = this.match(this.currentPath);
    }
    return this.currentMatch;
  }

  subscribe(listener: NavigationListener<TComponent, TMeta>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export function createNexoRouter<TComponent = any, TMeta = Record<string, unknown>>(
  routes?: readonly RouteDefinition<TComponent, TMeta>[]
): NexoRouter<TComponent, TMeta> {
  return new NexoRouter<TComponent, TMeta>(routes);
}
