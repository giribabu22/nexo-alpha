import type { BehaviorProvider } from "@nexo-alpha/behavior";
import type { ApplicationKnowledge } from "@nexo-alpha/context";

export interface Evidence {
  readonly id: string;
  readonly sourceUrl: string;
  readonly title: string;
  readonly content: string;
  readonly publishedAt?: string | undefined;
  readonly relevanceScore: number;
  readonly credibilityScore: number;
  readonly verified: boolean;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface SearchResultItem {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly publishedAt?: string | undefined;
}

export interface SearchQueryOptions {
  readonly maxResults?: number | undefined;
  readonly freshnessDays?: number | undefined;
  readonly allowedDomains?: readonly string[] | undefined;
}

export interface WebSearchProvider {
  readonly name: string;
  search(query: string, options?: SearchQueryOptions): Promise<readonly SearchResultItem[]>;
}

export interface ResearchOptions {
  readonly query: string;
  readonly maxSources?: number | undefined;
  readonly freshnessDays?: number | undefined;
  readonly provider?: WebSearchProvider | undefined;
  readonly behaviorProvider?: BehaviorProvider | undefined;
  readonly knowledge?: ApplicationKnowledge | undefined;
}

export interface ResearchResult {
  readonly query: string;
  readonly evidence: readonly Evidence[];
  readonly totalRetrieved: number;
  readonly totalVerified: number;
  readonly status: "SUCCESS" | "PARTIAL" | "INSUFFICIENT";
}