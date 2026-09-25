/**
 * Client for the projects API exposed by `createProjectApiModule()` in
 * `@nexo-alpha/core`. Reached through `client.projects` on a NexoClient.
 */

import type { NexoClient } from "./client.js";

export interface NexoProject {
  readonly id: string;
  readonly name: string;
  /** userId → roles within this project. */
  readonly members: Readonly<Record<string, readonly string[]>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class NexoProjectsClient {
  private readonly basePath: string;

  constructor(private readonly client: NexoClient, basePath = "/projects") {
    this.basePath = basePath.replace(/\/+$/, "");
  }

  /** Projects the signed-in user is a member of. */
  async list(): Promise<NexoProject[]> {
    return (await this.client.get<{ projects: NexoProject[] }>(this.basePath)).projects;
  }

  /** Creates a project; the signed-in user becomes its owner. */
  create(project: { readonly id: string; readonly name: string }): Promise<NexoProject> {
    return this.client.post<NexoProject>(this.basePath, project);
  }

  /** One project (404 for non-members). */
  get(projectId: string): Promise<NexoProject> {
    return this.client.get<NexoProject>(`${this.basePath}/${encodeURIComponent(projectId)}`);
  }

  /** Sets a member's roles; `[]` removes the member. Managers only. */
  setMember(projectId: string, userId: string, roles: readonly string[]): Promise<NexoProject> {
    return this.client.put<NexoProject>(
      `${this.basePath}/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
      { roles }
    );
  }
}
