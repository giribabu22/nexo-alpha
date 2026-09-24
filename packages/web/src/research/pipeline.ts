import type { ResearchOptions, ResearchResult } from "../types/index.js";
import { MockWebSearchProvider } from "../search/provider.js";
import { extractEvidenceFromSearchResults } from "../evidence/extractor.js";
import { verifyEvidence } from "../verification/verifier.js";

/**
 * Executes a full web research behavior pipeline:
 * Search ──► Extract ──► Behavior Verification ──► Knowledge Recording ──► Verified Evidence Data
 */
export async function research(options: ResearchOptions): Promise<ResearchResult> {
  const provider = options.provider ?? new MockWebSearchProvider();

  // 1. Search
  const searchResults = await provider.search(options.query, {
    maxResults: options.maxSources ?? 5,
    freshnessDays: options.freshnessDays
  });

  // 2. Extract Evidence
  const rawEvidence = extractEvidenceFromSearchResults(searchResults);

  // 3. Behavior Verification
  const verification = await verifyEvidence({
    query: options.query,
    evidence: rawEvidence,
    behaviorProvider: options.behaviorProvider
  });

  const verifiedCount = verification.verifiedEvidence.filter(e => e.verified).length;

  const status = verifiedCount === rawEvidence.length
    ? "SUCCESS"
    : verifiedCount > 0
      ? "PARTIAL"
      : "INSUFFICIENT";

  // 4. Record to Knowledge history if knowledge instance provided
  if (options.knowledge) {
    options.knowledge.addHistoryEntry({
      operation: "web_research",
      target: options.query,
      result: status === "INSUFFICIENT" ? "failed" : "success",
      detail: `Retrieved ${rawEvidence.length} items, verified ${verifiedCount} evidence snippets.`
    });
  }

  return {
    query: options.query,
    evidence: verification.verifiedEvidence,
    totalRetrieved: rawEvidence.length,
    totalVerified: verifiedCount,
    status
  };
}
