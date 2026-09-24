/**
 * UNDERSTAND layer — Intent parsing interface and parsers.
 *
 * This layer bridges natural language input to structured {@link DecisionIntent}
 * objects. The LLM or parser is strictly responsible for understanding intent;
 * it NEVER executes tools directly.
 */

import type { DecisionIntent } from "@nexo-alpha/decision";
import type { ApplicationContext } from "@nexo-alpha/context";

export interface IntentParserOptions {
  /** Application context for contextual intent parsing */
  context?: ApplicationContext | undefined;
  /** Available actions registered in the system (for prompt guidance or validation) */
  availableActions?: readonly string[] | undefined;
  /** Workflow state snapshot when executed inside a multi-step workflow */
  workflowState?: unknown | undefined;
}

/**
 * Contract for parsing natural language strings into structured DecisionIntents.
 */
export interface IntentParser {
  /**
   * Parse user input text into a DecisionIntent.
   */
  parse(input: string, options?: IntentParserOptions): Promise<DecisionIntent>;
}

export interface SimpleIntentParserMapping {
  /** Regex or substring pattern to match against user input */
  pattern: RegExp | string;
  /** Action string to produce when matched */
  action: string;
  /** Extractor for target ID or payload from match */
  extract?: (input: string, match: RegExpMatchArray | null) => { target?: string; payload?: Record<string, unknown> };
}

export interface SimpleIntentParserOptions {
  /** List of pattern-to-action mappings */
  mappings?: SimpleIntentParserMapping[];
  /** Default action when no pattern matches */
  defaultAction?: string;
  /** Default actor ID */
  defaultActor?: string;
}

/**
 * Creates a deterministic, pattern-matching IntentParser.
 * Useful for unit testing, offline environments, or simple command routing.
 *
 * ```ts
 * const parser = createSimpleIntentParser({
 *   mappings: [
 *     {
 *       pattern: /cancel (?:my )?order #?([a-z0-9_-]+)/i,
 *       action: "cancel_order",
 *       extract: (input, match) => ({ target: match?.[1] })
 *     }
 *   ]
 * });
 * ```
 */
export function createSimpleIntentParser(options: SimpleIntentParserOptions = {}): IntentParser {
  const mappings = options.mappings ?? [];
  const defaultActor = options.defaultActor ?? "user";

  return {
    async parse(input: string): Promise<DecisionIntent> {
      const trimmed = input.trim();

      for (const mapping of mappings) {
        let match: RegExpMatchArray | null = null;

        if (typeof mapping.pattern === "string") {
          if (trimmed.toLowerCase().includes(mapping.pattern.toLowerCase())) {
            match = [trimmed];
          }
        } else if (mapping.pattern instanceof RegExp) {
          match = trimmed.match(mapping.pattern);
        }

        if (match) {
          const extracted = mapping.extract?.(trimmed, match) ?? {};
          return {
            action: mapping.action,
            actor: defaultActor,
            ...(extracted.target !== undefined && { target: extracted.target }),
            ...(extracted.payload !== undefined && { payload: extracted.payload })
          };
        }
      }

      // If no mapping matched, fallback to defaultAction or infer from first word
      const action = options.defaultAction ?? trimmed.toLowerCase().split(/\s+/)[0] ?? "unknown";
      return {
        action,
        actor: defaultActor,
        payload: { rawInput: trimmed }
      };
    }
  };
}

/**
 * Creates a sequence-driven IntentParser for multi-step workflow execution and testing.
 * Advances through the list of intents on each step, returning `{ action: "complete" }`
 * once the sequence is exhausted.
 *
 * ```ts
 * const parser = createStepIntentParser([
 *   { action: "find_payment", target: "pay_123" },
 *   { action: "retry_payment", target: "pay_123" },
 *   { action: "activate_subscription", target: "sub_456" }
 * ]);
 * ```
 */
export function createStepIntentParser(
  steps: readonly DecisionIntent[]
): IntentParser {
  return {
    async parse(_input: string, options?: IntentParserOptions): Promise<DecisionIntent> {
      const state = options?.workflowState as { step?: number } | undefined;
      const currentStepIndex = (state?.step ?? 1) - 1;

      const stepIntent = steps[currentStepIndex];
      if (currentStepIndex >= 0 && currentStepIndex < steps.length && stepIntent !== undefined) {
        return stepIntent;
      }

      return {
        action: "complete",
        payload: { isComplete: true, message: "All planned steps completed." }
      };
    }
  };
}

