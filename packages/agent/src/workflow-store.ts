/**
 * Phase 7 — Persistent Workflow State & Memory.
 *
 * Provides persistence and retrieval mechanisms for {@link WorkflowState}.
 * Supports in-memory, ApplicationKnowledge journal, and file-backed storage.
 */

import type { ApplicationKnowledge } from "@nexo-alpha/context";
import type { WorkflowState, WorkflowStatus } from "./workflow.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface WorkflowFilter {
  readonly status?: WorkflowStatus | undefined;
  readonly workflowName?: string | undefined;
}

/**
 * Storage contract for persisting and retrieving WorkflowState snapshots.
 */
export interface WorkflowStore {
  /** Saves or updates a WorkflowState instance */
  save(state: WorkflowState): Promise<void>;
  /** Loads a WorkflowState instance by ID */
  load(id: string): Promise<WorkflowState | undefined>;
  /** Lists all stored WorkflowState instances matching an optional filter */
  list(filter?: WorkflowFilter): Promise<WorkflowState[]>;
  /** Deletes a WorkflowState instance by ID */
  delete(id: string): Promise<boolean>;
}

/**
 * Creates an in-memory WorkflowStore.
 */
export function createInMemoryWorkflowStore(): WorkflowStore {
  const store = new Map<string, WorkflowState>();

  return {
    async save(state) {
      // Store structured clone to prevent accidental outside mutation
      store.set(state.id, JSON.parse(JSON.stringify(state)));
    },

    async load(id) {
      const data = store.get(id);
      return data ? JSON.parse(JSON.stringify(data)) : undefined;
    },

    async list(filter) {
      let entries = Array.from(store.values());
      if (filter?.status) {
        entries = entries.filter((e) => e.status === filter.status);
      }
      if (filter?.workflowName) {
        entries = entries.filter((e) => e.workflowName === filter.workflowName);
      }
      return JSON.parse(JSON.stringify(entries));
    },

    async delete(id) {
      return store.delete(id);
    }
  };
}

/**
 * Creates a WorkflowStore backed by `@nexo-alpha/context`'s {@link ApplicationKnowledge}.
 * Records state snapshots and writes step progress directly to the application knowledge journal.
 */
export function createKnowledgeWorkflowStore(knowledge: ApplicationKnowledge): WorkflowStore {
  const inMemory = createInMemoryWorkflowStore();

  return {
    async save(state) {
      await inMemory.save(state);

      // Write execution progress summary into knowledge history journal
      knowledge.addHistoryEntry({
        operation: `workflow:${state.workflowName}:${state.status.toLowerCase()}`,
        target: state.id,
        result: state.status === "COMPLETED" ? "success" : state.status === "FAILED" ? "failed" : "denied",
        detail: `Workflow "${state.workflowName}" (${state.id}) step ${state.step} is ${state.status}.${
          state.error ? ` Error: ${state.error}` : ""
        }`
      });
    },

    async load(id) {
      return inMemory.load(id);
    },

    async list(filter) {
      return inMemory.list(filter);
    },

    async delete(id) {
      return inMemory.delete(id);
    }
  };
}

/**
 * Creates a file-system backed WorkflowStore (JSON file).
 * WorkflowState snapshots persist across Node process restarts.
 */
export function createFileWorkflowStore(filePath: string): WorkflowStore {
  async function readAll(): Promise<Record<string, WorkflowState>> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  async function writeAll(data: Record<string, WorkflowState>): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  return {
    async save(state) {
      const all = await readAll();
      all[state.id] = JSON.parse(JSON.stringify(state));
      await writeAll(all);
    },

    async load(id) {
      const all = await readAll();
      const data = all[id];
      return data ? JSON.parse(JSON.stringify(data)) : undefined;
    },

    async list(filter) {
      const all = await readAll();
      let entries = Object.values(all);
      if (filter?.status) {
        entries = entries.filter((e) => e.status === filter.status);
      }
      if (filter?.workflowName) {
        entries = entries.filter((e) => e.workflowName === filter.workflowName);
      }
      return JSON.parse(JSON.stringify(entries));
    },

    async delete(id) {
      const all = await readAll();
      if (!(id in all)) return false;
      delete all[id];
      await writeAll(all);
      return true;
    }
  };
}
