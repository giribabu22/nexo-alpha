export interface RouteMatchResult<T = unknown> {
  readonly route: T;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly matchedSegments: readonly string[];
}

interface TrieNode<T = unknown> {
  part: string;
  isParam: boolean;
  paramName?: string;
  isWildcard: boolean;
  children: Map<string, TrieNode<T>>;
  paramChild?: TrieNode<T>;
  wildcardChild?: TrieNode<T>;
  handler?: T;
  fullPath?: string;
}

function normalizePath(path: string): string[] {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return [];
  return trimmed.split("/").filter(Boolean);
}

export class NexoRadixTrie<T = unknown> {
  private readonly root: TrieNode<T> = {
    part: "",
    isParam: false,
    isWildcard: false,
    children: new Map()
  };

  insert(path: string, handler: T): this {
    const segments = normalizePath(path);
    let current = this.root;

    for (const segment of segments) {
      if (segment.startsWith(":") || (segment.startsWith("{") && segment.endsWith("}"))) {
        const paramName = segment.startsWith(":") ? segment.slice(1) : segment.slice(1, -1);
        if (!current.paramChild) {
          current.paramChild = {
            part: segment,
            isParam: true,
            paramName,
            isWildcard: false,
            children: new Map()
          };
        }
        current = current.paramChild;
      } else if (segment === "*" || segment === "/*") {
        if (!current.wildcardChild) {
          current.wildcardChild = {
            part: "*",
            isParam: false,
            isWildcard: true,
            children: new Map()
          };
        }
        current = current.wildcardChild;
        break; // Wildcard matches all subsequent segments
      } else {
        if (!current.children.has(segment)) {
          current.children.set(segment, {
            part: segment,
            isParam: false,
            isWildcard: false,
            children: new Map()
          });
        }
        current = current.children.get(segment)!;
      }
    }

    current.handler = handler;
    current.fullPath = path;
    return this;
  }

  match(urlPath: string): RouteMatchResult<T> | null {
    const segments = normalizePath(urlPath);
    const params: Record<string, string> = {};

    let current = this.root;

    // Handle root path "/"
    if (segments.length === 0) {
      if (current.handler !== undefined) {
        return {
          route: current.handler,
          path: current.fullPath ?? "/",
          params: {},
          matchedSegments: []
        };
      }
      return null;
    }

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;

      // 1. Exact static segment match (fastest $O(1)$)
      if (current.children.has(segment)) {
        current = current.children.get(segment)!;
        continue;
      }

      // 2. Parameter segment match
      if (current.paramChild) {
        current = current.paramChild;
        if (current.paramName) {
          params[current.paramName] = decodeURIComponent(segment);
        }
        continue;
      }

      // 3. Wildcard segment match
      if (current.wildcardChild) {
        current = current.wildcardChild;
        params["*"] = segments.slice(i).map(decodeURIComponent).join("/");
        break;
      }

      // No match found
      return null;
    }

    if (current.handler !== undefined) {
      return {
        route: current.handler,
        path: current.fullPath ?? urlPath,
        params,
        matchedSegments: segments
      };
    }

    // Fallback to wildcard on the current node if available
    if (current.wildcardChild && current.wildcardChild.handler !== undefined) {
      return {
        route: current.wildcardChild.handler,
        path: current.wildcardChild.fullPath ?? urlPath,
        params: { ...params, "*": "" },
        matchedSegments: segments
      };
    }

    return null;
  }
}
