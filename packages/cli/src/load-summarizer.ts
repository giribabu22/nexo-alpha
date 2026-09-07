import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { KnowledgeNodeSummarizer } from "@nexo-alpha/tools";

function isKnowledgeNodeSummarizer(value: unknown): value is KnowledgeNodeSummarizer {
  return typeof value === "function";
}

export async function loadSummarizer(
  modulePath: string
): Promise<KnowledgeNodeSummarizer> {
  const absolutePath = resolve(process.cwd(), modulePath);
  const imported: Record<string, unknown> = await import(
    pathToFileURL(absolutePath).href
  );

  const summarize = imported.summarize ?? imported.default;

  if (!isKnowledgeNodeSummarizer(summarize)) {
    throw new Error(
      `"${modulePath}" does not export a summarizer function. Expected a named "summarize" export or default export matching KnowledgeNodeSummarizer: (node) => string | undefined | Promise<string | undefined>.`
    );
  }

  return summarize;
}
