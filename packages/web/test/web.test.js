import test from "node:test";
import assert from "node:assert/strict";

import {
  MockWebSearchProvider,
  extractEvidenceFromSearchResults,
  verifyEvidence,
  research
} from "../dist/index.js";

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
  const result = await verifyEvidence({ query: "React 20", evidence: raw });
  assert.equal(result.verifiedEvidence.length, 1);
  assert.ok(result.verifiedEvidence[0].verified);
});

test("research() runs full search -> extract -> verify pipeline", async () => {
  const res = await research({ query: "What changed in React 20?" });
  assert.equal(res.query, "What changed in React 20?");
  assert.ok(res.totalRetrieved > 0);
  assert.ok(res.totalVerified > 0);
  assert.ok(res.status === "SUCCESS" || res.status === "PARTIAL");
});
