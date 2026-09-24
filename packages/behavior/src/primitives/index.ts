import { ChoiceDefinition, ScoreDefinition, BooleanDefinition } from '../types/primitives.js';

/**
 * Atomic Primitive: Choice
 * Selects exactly one option from a constrained list of valid strings.
 */
export function choice<T extends string>(
  options: readonly T[],
  description?: string
): ChoiceDefinition<T> {
  if (!options || options.length === 0) {
    throw new Error('choice() primitive requires at least one option.');
  }
  return {
    type: 'choice',
    options,
    description
  };
}

/**
 * Atomic Primitive: Score
 * Evaluates a numeric score within a bounded range (default 0 to 1).
 */
export function score(
  options: { min?: number; max?: number; description?: string } = {}
): ScoreDefinition {
  return {
    type: 'score',
    min: options.min ?? 0,
    max: options.max ?? 1,
    description: options.description
  };
}

/**
 * Atomic Primitive: Boolean (Noul)
 * Evaluates a binary boolean outcome based on given criteria.
 */
export function boolean(
  criteria?: string,
  description?: string
): BooleanDefinition {
  return {
    type: 'boolean',
    criteria,
    description
  };
}
