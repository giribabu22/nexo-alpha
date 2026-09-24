import { BehaviorEngine } from '../behavior/engine.js';
import { BehaviorProvider } from '../types/provider.js';
import {
  RoutePolicyOptions, RoutePolicyResult,
  VerifyPolicyOptions, VerifyPolicyResult,
  RetryPolicyOptions, RetryPolicyResult,
  CompletePolicyOptions, CompletePolicyResult,
  EscalatePolicyOptions, EscalatePolicyResult
} from '../types/policies.js';

export async function route<T extends string>(
  options: RoutePolicyOptions<T>,
  provider?: BehaviorProvider | undefined
): Promise<RoutePolicyResult<T>> {
  const engine = new BehaviorEngine({ provider });
  return engine.route(options);
}

export async function verify(
  options: VerifyPolicyOptions,
  provider?: BehaviorProvider | undefined
): Promise<VerifyPolicyResult> {
  const engine = new BehaviorEngine({ provider });
  return engine.verify(options);
}

export async function retry(
  options: RetryPolicyOptions,
  provider?: BehaviorProvider | undefined
): Promise<RetryPolicyResult> {
  const engine = new BehaviorEngine({ provider });
  return engine.retry(options);
}

export async function complete(
  options: CompletePolicyOptions,
  provider?: BehaviorProvider | undefined
): Promise<CompletePolicyResult> {
  const engine = new BehaviorEngine({ provider });
  return engine.complete(options);
}

export async function escalate(
  options: EscalatePolicyOptions,
  provider?: BehaviorProvider | undefined
): Promise<EscalatePolicyResult> {
  const engine = new BehaviorEngine({ provider });
  return engine.escalate(options);
}
