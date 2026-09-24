import type { Evidence, SearchResultItem } from "../types/index.js";

export function extractEvidenceFromSearchResults(
  results: readonly SearchResultItem[]
): readonly Evidence[] {
  return results.map((item, index) => ({
    id: `ev_${index + 1}_${Math.random().toString(36).substring(2, 7)}`,
    sourceUrl: item.url,
    title: item.title,
    content: item.snippet,
    publishedAt: item.publishedAt,
    relevanceScore: 0.85,
    credibilityScore: item.url.startsWith("https") ? 0.9 : 0.7,
    verified: false
  }));
}
