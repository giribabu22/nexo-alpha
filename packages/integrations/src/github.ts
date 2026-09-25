/**
 * GitHub toolkit: lets an agent create issues and comment on issues/PRs in
 * one repository, through the GitHub REST API.
 *
 * | Action                  | Payload                         | Permission            |
 * |-------------------------|---------------------------------|-----------------------|
 * | `github_create_issue`   | `{ title, body?, labels? }`     | `github:issues:write` |
 * | `github_comment`        | `{ number, body }`              | `github:issues:write` |
 * | `github_get_issue`      | `{ number }`                    | `github:issues:read`  |
 *
 * Use a fine-grained token scoped to the one repository with only the
 * "Issues" permission.
 */

import type { AgentToolkit, NexoTool } from "@nexo-alpha/agent";
import { invalidInput, requestJson, requiredString, type HttpToolOptions } from "./http.js";

export interface GitHubToolkitOptions extends HttpToolOptions {
  /** Token sent as `Authorization: Bearer <token>`. */
  readonly token: string;
  /** "owner/repo" — the only repository the tools can touch. */
  readonly repository: string;
  /** API base URL (GitHub Enterprise). Default: "https://api.github.com" */
  readonly apiUrl?: string | undefined;
}

export function createGitHubToolkit(options: GitHubToolkitOptions): AgentToolkit {
  if (!/^[\w.-]+\/[\w.-]+$/.test(options.repository)) {
    throw new Error(`Invalid GitHub repository "${options.repository}"; expected "owner/repo".`);
  }
  if (options.token.trim() === "") throw new Error("createGitHubToolkit() needs a token.");

  const base = `${(options.apiUrl ?? "https://api.github.com").replace(/\/+$/, "")}/repos/${options.repository}`;
  const headers = {
    authorization: `Bearer ${options.token}`,
    "x-github-api-version": "2022-11-28",
    "user-agent": "nexo-integrations"
  };
  const issueNumber = (payload: Readonly<Record<string, unknown>> | undefined): number | undefined => {
    const value = payload?.number;
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
  };

  const tools: NexoTool[] = [
    {
      action: "github_create_issue",
      description: `Creates an issue in ${options.repository}`,
      permissions: ["github:issues:write"],
      async execute({ intent }) {
        const title = requiredString(intent.payload, "title");
        if (title === undefined) return invalidInput('"title" is required.');
        const labels = intent.payload?.labels;
        if (labels !== undefined && (!Array.isArray(labels) || !labels.every((label) => typeof label === "string"))) {
          return invalidInput('"labels" must be an array of strings.');
        }
        const body = requiredString(intent.payload, "body");
        const result = await requestJson(options, `${base}/issues`, {
          method: "POST",
          headers,
          body: { title, ...(body !== undefined ? { body } : {}), ...(labels !== undefined ? { labels } : {}) }
        });
        if (!result.success) return result;
        const issue = result.data as { number: number; html_url: string };
        return { ...result, data: { number: issue.number, url: issue.html_url } };
      }
    },
    {
      action: "github_comment",
      description: `Comments on an issue or pull request in ${options.repository}`,
      permissions: ["github:issues:write"],
      async execute({ intent }) {
        const number = issueNumber(intent.payload);
        const body = requiredString(intent.payload, "body");
        if (number === undefined) return invalidInput('"number" must be a positive integer.');
        if (body === undefined) return invalidInput('"body" is required.');
        const result = await requestJson(options, `${base}/issues/${number}/comments`, { method: "POST", headers, body: { body } });
        if (!result.success) return result;
        const comment = result.data as { id: number; html_url: string };
        return { ...result, data: { id: comment.id, url: comment.html_url } };
      }
    },
    {
      action: "github_get_issue",
      description: `Reads an issue in ${options.repository}`,
      permissions: ["github:issues:read"],
      async execute({ intent }) {
        const number = issueNumber(intent.payload);
        if (number === undefined) return invalidInput('"number" must be a positive integer.');
        const result = await requestJson(options, `${base}/issues/${number}`, { method: "GET", headers });
        if (!result.success) return result;
        const issue = result.data as { number: number; title: string; state: string; html_url: string; labels: { name: string }[] };
        return {
          ...result,
          data: { number: issue.number, title: issue.title, state: issue.state, url: issue.html_url, labels: issue.labels.map((label) => label.name) }
        };
      }
    }
  ];

  return { name: "github", description: `GitHub issues for ${options.repository}`, tools };
}
