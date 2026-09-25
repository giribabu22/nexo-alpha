/**
 * Slack toolkit: lets an agent post messages to a channel through a Slack
 * incoming webhook (https://api.slack.com/messaging/webhooks).
 *
 * | Action               | Payload             | Permission   |
 * |----------------------|---------------------|--------------|
 * | `slack_post_message` | `{ text, blocks? }` | `slack:post` |
 *
 * The webhook URL is a secret (anyone holding it can post): keep it in
 * configuration, never in intents or logs.
 */

import type { AgentToolkit } from "@nexo-alpha/agent";
import { invalidInput, requestJson, requiredString, type HttpToolOptions } from "./http.js";

export interface SlackToolkitOptions extends HttpToolOptions {
  /** Incoming webhook URL. */
  readonly webhookUrl: string;
  /** Maximum message length accepted from the agent. Default: 3000 */
  readonly maxTextLength?: number | undefined;
}

export function createSlackToolkit(options: SlackToolkitOptions): AgentToolkit {
  let url: URL;
  try {
    url = new URL(options.webhookUrl);
  } catch {
    throw new Error("createSlackToolkit() needs a valid webhookUrl.");
  }
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("Slack webhook URLs must use https.");
  }
  const maxTextLength = options.maxTextLength ?? 3000;

  return {
    name: "slack",
    description: "Post messages to a Slack channel",
    tools: [
      {
        action: "slack_post_message",
        description: "Posts a message to the configured Slack channel",
        permissions: ["slack:post"],
        async execute({ intent }) {
          const text = requiredString(intent.payload, "text");
          if (text === undefined) return invalidInput('"text" is required.');
          if (text.length > maxTextLength) return invalidInput(`"text" exceeds ${maxTextLength} characters.`);
          const blocks = intent.payload?.blocks;
          if (blocks !== undefined && !Array.isArray(blocks)) return invalidInput('"blocks" must be an array.');

          const result = await requestJson(options, url.toString(), {
            method: "POST",
            headers: {},
            body: { text, ...(blocks !== undefined ? { blocks } : {}) }
          });
          // Never echo the webhook URL back into results or audit records.
          return result.success ? { ...result, data: { posted: true } } : result;
        }
      }
    ]
  };
}
