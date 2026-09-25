# @nexo-alpha/integrations

> Agent toolkits for external services: GitHub and Slack.

Each toolkit is a bundle of agent tools. Every tool declares the permissions it needs, so the Decision Engine and RBAC (`toolPermissionRule`) gate it like any other tool.

```ts
import { installToolkit } from "@nexo-alpha/agent";
import { createGitHubToolkit, createSlackToolkit } from "@nexo-alpha/integrations";

installToolkit(agent, createGitHubToolkit({ token: process.env.GITHUB_TOKEN!, repository: "acme/app" }));
installToolkit(agent, createSlackToolkit({ webhookUrl: process.env.SLACK_WEBHOOK_URL! }));
```

| Toolkit | Action | Payload | Permission |
|---|---|---|---|
| GitHub | `github_create_issue` | `{ title, body?, labels? }` | `github:issues:write` |
| GitHub | `github_comment` | `{ number, body }` | `github:issues:write` |
| GitHub | `github_get_issue` | `{ number }` | `github:issues:read` |
| Slack | `slack_post_message` | `{ text, blocks? }` | `slack:post` |

Invalid input, non-2xx responses and network errors come back as failed tool results (`{ success: false, error }`); the tools never throw. Each request times out after 10s by default (`timeoutMs`).

**Credentials:**
- Use a fine-grained GitHub token scoped to the one repository, with only the Issues permission.
- The Slack webhook URL is a secret. Keep it in configuration; the tool never echoes it in results or audit records.

## Writing your own toolkit

A toolkit is just `{ name, tools, verifiers? }` (the `AgentToolkit` type in `@nexo-alpha/agent`). `installToolkit()` registers everything or nothing: it throws if any action is already registered.
