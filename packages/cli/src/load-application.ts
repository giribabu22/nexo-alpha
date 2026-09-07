import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { NexoApplication } from "@nexo-alpha/core";
import type { ApplicationKnowledge } from "@nexo-alpha/context";

export interface LoadedApplication {
  readonly app: NexoApplication;
  readonly knowledge?: ApplicationKnowledge | undefined;
}

function isNexoApplication(value: unknown): value is NexoApplication {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { getModules?: unknown }).getModules === "function"
  );
}

function isApplicationKnowledge(value: unknown): value is ApplicationKnowledge {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { getDecisions?: unknown }).getDecisions === "function"
  );
}

export async function loadApplication(
  modulePath: string
): Promise<LoadedApplication> {
  const absolutePath = resolve(process.cwd(), modulePath);
  const imported: Record<string, unknown> = await import(
    pathToFileURL(absolutePath).href
  );

  const app = imported.app ?? imported.default;

  if (!isNexoApplication(app)) {
    throw new Error(
      `"${modulePath}" does not export a Nexo application. Expected a named "app" export or default export with a Nexo application instance.`
    );
  }

  const knowledge = isApplicationKnowledge(imported.knowledge)
    ? imported.knowledge
    : undefined;

  return { app, knowledge };
}
