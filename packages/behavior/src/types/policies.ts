export interface RoutePolicyOptions<T extends string = string> {
  state: unknown;
  candidates: readonly T[];
  context?: string | undefined;
}

export interface RoutePolicyResult<T extends string = string> {
  selected: T;
  confidence: number;
  explanation?: string | undefined;
}

export interface VerifyPolicyOptions {
  expected: string;
  actual: unknown;
  context?: string | undefined;
}

export interface VerifyPolicyResult {
  status: 'verified' | 'failed' | 'uncertain';
  confidence: number;
  reason?: string | undefined;
}

export interface RetryPolicyOptions {
  error: Error | string;
  attempt: number;
  maxAttempts: number;
  context?: unknown | undefined;
}

export interface RetryPolicyResult {
  retry: boolean;
  strategy?: 'immediate' | 'backoff' | 'fallback' | undefined;
  confidence: number;
  reason?: string | undefined;
}

export type CompletionStatus = 'COMPLETE' | 'IN_PROGRESS' | 'VERIFY_MORE' | 'BLOCKED' | 'FAILED' | 'ESCALATE';

export interface CompletePolicyOptions {
  goal: string;
  history?: unknown[] | undefined;
  currentState?: unknown | undefined;
}

export interface CompletePolicyResult {
  status: CompletionStatus;
  confidence: number;
  reason?: string | undefined;
}

export interface EscalatePolicyOptions {
  state: unknown;
  confidenceThreshold?: number | undefined;
  context?: string | undefined;
}

export interface EscalatePolicyResult {
  escalate: boolean;
  action: 'ACT' | 'REVIEW' | 'HUMAN_ESCALATE';
  confidence: number;
  reason?: string | undefined;
}
