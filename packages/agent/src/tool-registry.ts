import type { DecisionIntent } from "@nexo-alpha/decision";

/**
 * The result of executing a registered tool.
 *
 * `success`     — whether the tool completed without error.
 * `data`        — the tool's return value on success (arbitrary, tool-specific).
 * `error`       — human-readable error message on failure.
 * `durationMs`  — wall-clock execution time.
 */
export interface ToolResult {
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: string | undefined;
  readonly durationMs: number;
}

/**
 * The context passed into every tool handler at call time.
 * Contains the original intent plus any runtime extras the agent
 * was configured with.
 */
export interface ToolContext {
  /** The intent that triggered this tool call. */
  readonly intent: DecisionIntent;
  /** Arbitrary extras injected by the agent (e.g. a live DB client). */
  readonly extras?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * A registered application-level tool — a named, typed handler for one
 * specific action the agent is allowed to perform.
 *
 * Tools are registered on a {@link ToolRegistry} and are only ever called
 * after the Decision Engine returns `APPROVE`. They are the ACT layer of
 * `UNDERSTAND → KNOW → DECIDE → ACT → VERIFY`.
 *
 * A tool corresponds to one concrete thing the system can do:
 * - `cancel_order`
 * - `refund_order`
 * - `send_notification`
 * - `delete_account`
 *
 * The `action` field must match `DecisionIntent.action` exactly — this is
 * how the ToolRegistry routes an approved intent to the right handler.
 */
export interface NexoTool {
  /**
   * The action name this tool handles. Must match `DecisionIntent.action`
   * exactly (case-sensitive).
   */
  readonly action: string;
  /** Human-readable description — used in logs and error messages. */
  readonly description?: string | undefined;
  /**
   * The tool handler. Receives the full call context and returns a result.
   * May be synchronous or asynchronous.
   */
  execute(ctx: ToolContext): ToolResult | Promise<ToolResult>;
}

/**
 * A registry of application-level tools that the agent can execute.
 *
 * Tools are registered by `action` name and called by the agent's execution
 * layer after the Decision Engine approves an intent.
 */
export interface ToolRegistry {
  /**
   * Registers one or more tools. Throws if a tool with the same `action`
   * name is already registered.
   */
  register(...tools: NexoTool[]): this;
  /**
   * Removes a registered tool by `action` name.
   * Returns `true` if found and removed, `false` otherwise.
   */
  unregister(action: string): boolean;
  /** Whether a tool for the given `action` is registered. */
  has(action: string): boolean;
  /** Names of all registered actions. */
  readonly actions: readonly string[];
  /**
   * Executes the tool registered for `intent.action`.
   * Returns a failed result if no tool is registered — does not throw.
   */
  run(intent: DecisionIntent, extras?: Readonly<Record<string, unknown>>): Promise<ToolResult>;
}

/**
 * Creates a new {@link ToolRegistry}.
 *
 * ```ts
 * const tools = createToolRegistry();
 *
 * tools.register({
 *   action: "cancel_order",
 *   description: "Cancels a pending order",
 *   async execute({ intent }) {
 *     await db.orders.cancel(intent.target);
 *     return { success: true, data: { cancelled: intent.target } };
 *   }
 * });
 * ```
 */
export function createToolRegistry(): ToolRegistry {
  const map = new Map<string, NexoTool>();

  const registry: ToolRegistry = {
    register(...tools) {
      for (const tool of tools) {
        if (map.has(tool.action)) {
          throw new Error(
            `[ToolRegistry] A tool for action "${tool.action}" is already registered.`
          );
        }
        map.set(tool.action, tool);
      }
      return registry;
    },

    unregister(action) {
      return map.delete(action);
    },

    has(action) {
      return map.has(action);
    },

    get actions() {
      return [...map.keys()];
    },

    async run(intent, extras) {
      const tool = map.get(intent.action);

      if (!tool) {
        return {
          success: false,
          error: `No tool registered for action "${intent.action}". Registered actions: [${[...map.keys()].join(", ") || "none"}].`,
          durationMs: 0
        };
      }

      const startMs = Date.now();
      try {
        const ctx: ToolContext = { intent, extras };
        const result = await tool.execute(ctx);
        // Ensure durationMs is always set (tool author may have omitted it)
        return {
          ...result,
          durationMs: result.durationMs > 0 ? result.durationMs : Date.now() - startMs
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startMs
        };
      }
    }
  };

  return registry;
}
