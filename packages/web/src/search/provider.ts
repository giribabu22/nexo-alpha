import type { SearchQueryOptions, SearchResultItem, WebSearchProvider } from "../types/index.js";

export class MockWebSearchProvider implements WebSearchProvider {
  public readonly name = "mock-search";
  private items: readonly SearchResultItem[];

  constructor(items?: readonly SearchResultItem[]) {
    this.items = items ?? [
      {
        url: "https://example.com/docs/react-20",
        title: "React 20 Release Notes & Features",
        snippet: "React 20 introduces novel compiler optimizations, server actions v2, and async transition primitives.",
        publishedAt: "2026-01-15T00:00:00Z"
      },
      {
        url: "https://example.org/blog/react-20-guide",
        title: "Complete Migration Guide to React 20",
        snippet: "Upgrading to React 20 requires updating root hydration patterns and adopting automatic memoization.",
        publishedAt: "2026-02-01T00:00:00Z"
      }
    ];
  }

  async search(query: string, options?: SearchQueryOptions): Promise<readonly SearchResultItem[]> {
    const max = options?.maxResults ?? 5;
    return this.items.slice(0, max);
  }
}
