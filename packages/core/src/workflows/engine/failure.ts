import type { StepDef } from '../dsl/types.js';

export type FailureDecision = { kind: 'retry'; delayMs: number } | { kind: 'continue' } | { kind: 'fail' };

export function decideFailure(step: StepDef, attempt: number, outcome: { retryable: boolean }): FailureDecision {
  const retry = step.retry;
  if (retry && outcome.retryable && attempt < retry.attempts) {
    const base = retry.initialDelayMs ?? 5000;
    const delayMs = retry.backoff === 'exponential' ? base * 2 ** (attempt - 1) : base;
    return { kind: 'retry', delayMs };
  }
  if ((step.on_failure ?? 'fail') === 'continue') return { kind: 'continue' };
  return { kind: 'fail' };
}
