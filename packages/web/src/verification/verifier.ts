import { BehaviorEngine, createBehaviorEngine, type BehaviorProvider } from "@nexo-alpha/behavior";
import type { Evidence } from "../types/index.js";

export interface VerifyEvidenceOptions {
  readonly query: string;
  readonly evidence: readonly Evidence[];
  readonly behaviorProvider?: BehaviorProvider | undefined;
}

export interface VerifiedEvidenceOutput {
  readonly verifiedEvidence: readonly Evidence[];
  readonly sufficient: boolean;
}

/**
 * Behavior-guided evidence verification. Evaluates relevance, credibility,
 * and safety of evidence treating content strictly as data, not instructions.
 */
export async function verifyEvidence(
  options: VerifyEvidenceOptions
): Promise<VerifiedEvidenceOutput> {
  const engine = createBehaviorEngine({ provider: options.behaviorProvider });

  const verifiedList: Evidence[] = [];

  for (const item of options.evidence) {
    // Evaluate validity using behavior primitives
    const verification = await engine.verify({
      expected: `Content is relevant and grounded to query: "${options.query}"`,
      actual: {
        title: item.title,
        content: item.content,
        url: item.sourceUrl
      }
    });

    const isVerified = verification.status === "verified";
    verifiedList.push({
      ...item,
      relevanceScore: verification.confidence,
      verified: isVerified
    });
  }

  // Check overall sufficiency using behavior engine
  const sufficiencyCheck = await engine.complete({
    goal: `Sufficient evidence retrieved for query: "${options.query}"`,
    history: verifiedList.filter(e => e.verified)
  });

  const sufficient = sufficiencyCheck.status === "COMPLETE";

  return {
    verifiedEvidence: verifiedList,
    sufficient
  };
}
