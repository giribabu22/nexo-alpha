/**
 * Layer 1 Atomic Decision Definitions
 */

export interface ChoiceDefinition<T extends string = string> {
  type: 'choice';
  options: readonly T[];
  description?: string | undefined;
}

export interface ScoreDefinition {
  type: 'score';
  min?: number | undefined;
  max?: number | undefined;
  description?: string | undefined;
}

export interface BooleanDefinition {
  type: 'boolean';
  criteria?: string | undefined;
  description?: string | undefined;
}

export type AtomicDecisionDefinition = ChoiceDefinition | ScoreDefinition | BooleanDefinition;

export type QuestionMap = Record<string, AtomicDecisionDefinition>;
