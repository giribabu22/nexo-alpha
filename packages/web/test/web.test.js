import test from "node:test";
import assert from "node:assert/strict";

import { LocalBehaviorProvider } from "@nexo-alpha/behavior";
import {
  MockWebSearchProvider,
  extractEvidenceFromSearchResults,
  verifyEvidence,
  research
} from "../dist/index.js";

/** A behavior provider that judges every result relevant and the evidence sufficient. */
const approving = () => new LocalBehaviorProvider((key) => ({
  value: { matches: true, quality: 0.9, status: "COMPLETE" }[key],
  confidence: 0.9
}));

test("MockWebSearchProvider returns structured search results", async () => {
  const provider = new MockWebSearchProvider();
  const results = await provider.search("React 20", { maxResults: 2 });
  assert.equal(results.length, 2);
  assert.ok(results[0].url);
  assert.ok(results[0].title);
});

test("extractEvidenceFromSearchResults converts items to Evidence objects", () => {
  const items = [
    { url: "https://react.dev", title: "React Docs", snippet: "React docs snippet" }
  ];
  const evidence = extractEvidenceFromSearchResults(items);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].sourceUrl, "https://react.dev");
  assert.equal(evidence[0].verified, false);
});

test("verifyEvidence evaluates evidence validity using behavior engine", async () => {
  const items = [
    { url: "https://react.dev", title: "React 20 Docs", snippet: "React release" }
  ];
  const raw = extractEvidenceFromSearchResults(items);
  const result = await verifyEvidence({ query: "React 20", evidence: raw, behaviorProvider: approving() });
  assert.equal(result.verifiedEvidence.length, 1);
  assert.equal(result.verifiedEvidence[0].verified, true);
  assert.equal(result.sufficient, true);
});

test("verifyEvidence without a behavior provider verifies nothing", async () => {
  const raw = extractEvidenceFromSearchResults([
    { url: "https://react.dev", title: "React 20 Docs", snippet: "React release" }
  ]);
  const result = await verifyEvidence({ query: "React 20", evidence: raw });
  assert.equal(result.verifiedEvidence[0].verified, false);
  assert.equal(result.verifiedEvidence[0].relevanceScore, 0);
  assert.equal(result.sufficient, false);
});

test("research() runs full search -> extract -> verify pipeline", async () => {
  const res = await research({
    query: "What changed in React 20?",
    provider: new MockWebSearchProvider(),
    behaviorProvider: approving()
  });
  assert.equal(res.query, "What changed in React 20?");
  assert.equal(res.totalRetrieved, 2);
  assert.equal(res.totalVerified, 2);
  assert.equal(res.sufficient, true);
  assert.equal(res.status, "SUCCESS");
});

test("research() needs a search provider", async () => {
  await assert.rejects(research({ query: "anything" }), /needs a search provider/);
});

test("research() without a behavior provider reports INSUFFICIENT and records a failure", async () => {
  const history = [];
  const res = await research({
    query: "What changed in React 20?",
    provider: new MockWebSearchProvider(),
    knowledge: { addHistoryEntry: (entry) => history.push(entry) }
  });
  assert.equal(res.totalVerified, 0);
  assert.equal(res.sufficient, false);
  assert.equal(res.status, "INSUFFICIENT");
  assert.equal(history[0].result, "failed");
});

test("research() is PARTIAL when every result is verified but the evidence is judged insufficient", async () => {
  const res = await research({
    query: "What changed in React 20?",
    provider: new MockWebSearchProvider(),
    behaviorProvider: new LocalBehaviorProvider((key) => ({
      value: { matches: true, quality: 0.9, status: "VERIFY_MORE" }[key],
      confidence: 0.9
    }))
  });
  assert.equal(res.totalVerified, 2);
  assert.equal(res.sufficient, false);
  assert.equal(res.status, "PARTIAL");
});
