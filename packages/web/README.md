# @nexo-alpha/web

> Web search, evidence retrieval, and claim verification pipeline for the Nexo framework.

`@nexo-alpha/web` gives Nexo AI agents and applications a grounded, verifiable web research pipeline:
**`Search ──► Extract Evidence ──► Behavior Verification ──► Knowledge Recording`**

---

## Installation

```bash
npm install @nexo-alpha/web @nexo-alpha/behavior @nexo-alpha/context
```

Or using pnpm:

```bash
pnpm add @nexo-alpha/web @nexo-alpha/behavior @nexo-alpha/context
```

---

## How to Use

### 1. High-Level Research Pipeline (`research`)

Execute an end-to-end research query that searches the web, extracts snippets, verifies their factual relevance using bounded behaviors, and records the findings:

```ts
import { research, MockWebSearchProvider } from "@nexo-alpha/web";
import { createKnowledge } from "@nexo-alpha/context";

const knowledge = createKnowledge();

const result = await research({
  query: "React 19 compiler release features",
  maxSources: 5,
  freshnessDays: 60,
  provider: new MockWebSearchProvider(),
  knowledge
});

console.log("Status:", result.status); // "SUCCESS" | "PARTIAL" | "INSUFFICIENT"
console.log(`Found ${result.totalRetrieved} snippets, ${result.totalVerified} verified.`);

for (const snippet of result.evidence) {
  console.log(`[${snippet.title}] (${snippet.url})`);
  console.log(`Verified: ${snippet.verified} | Confidence: ${snippet.confidence}`);
  console.log(snippet.snippet);
}
```

---

### 2. Implementing Custom Search Providers (`WebSearchProvider`)

Nexo defines a provider-agnostic interface so you can easily plug in Tavily, Google, Bing, SerpAPI, or your internal knowledge base:

```ts
import type { WebSearchProvider, SearchQueryOptions, SearchResultItem } from "@nexo-alpha/web";

export class TavilySearchProvider implements WebSearchProvider {
  public readonly name = "tavily";

  constructor(private readonly apiKey: string) {}

  async search(query: string, options?: SearchQueryOptions): Promise<readonly SearchResultItem[]> {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: options?.maxResults ?? 5
      })
    });

    const data = await response.json();
    return data.results.map((r: any) => ({
      url: r.url,
      title: r.title,
      snippet: r.content,
      publishedAt: r.published_date
    }));
  }
}
```

---

### 3. Extracting Evidence (`extractEvidenceFromSearchResults`)

Convert raw search results into structured, deduplicated evidence snippets:

```ts
import { extractEvidenceFromSearchResults } from "@nexo-alpha/web";

const rawResults = [
  {
    url: "https://nodejs.org/en/blog/release/v22.0.0",
    title: "Node.js 22 Release Announcement",
    snippet: "Node.js 22 includes V8 12.4, Maglev compiler enabled by default, and WebSocket client support."
  }
];

const evidence = extractEvidenceFromSearchResults(rawResults);
console.log(evidence[0].id); // unique deterministic SHA-256 evidence snippet ID
```

---

### 4. Verifying Evidence with Bounded Behaviors (`verifyEvidence`)

Validate whether extracted snippets actually answer or support the search query:

```ts
import { verifyEvidence } from "@nexo-alpha/web";

const verified = await verifyEvidence({
  query: "Does Node 22 include WebSocket support by default?",
  evidence
});

console.log(verified.verifiedEvidence[0].verified); // true
console.log(verified.verifiedEvidence[0].confidence); // 0.95
```

---

## Integration with `@nexo-alpha/agent`

If you are using [`@nexo-alpha/agent`](https://www.npmjs.com/package/@nexo-alpha/agent), the research pipeline is directly accessible on any agent instance:

```ts
import { createAgent } from "@nexo-alpha/agent";

const agent = createAgent({ decisionEngine });

// Automatically searches, verifies, and records to the agent's knowledge store:
const research = await agent.research("PostgreSQL 17 performance improvements");
```

---

## Related Packages

- [`@nexo-alpha/agent`](https://www.npmjs.com/package/@nexo-alpha/agent) — AI agent orchestration layer.
- [`@nexo-alpha/behavior`](https://www.npmjs.com/package/@nexo-alpha/behavior) — Bounded decision engine for verifying evidence without hallucination.
- [`@nexo-alpha/context`](https://www.npmjs.com/package/@nexo-alpha/context) — Stores research findings in application knowledge journals.

---

## License

MIT © Nexo Contributors
