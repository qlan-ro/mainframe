import type { ChooseStep } from '../dsl/types.js';
import { renderCondition, renderValue } from '../template/render.js';
import type { Scope, StepContext, StepOutcome, WalkResult } from './types.js';
import type { StepDef } from '../dsl/types.js';

/** Callback type for recursing into a nested step sequence. */
export type NestedWalker = (steps: StepDef[], pathPrefix: string, scope: Scope) => Promise<WalkResult>;

/**
 * Execute a `choose` block: evaluate arms top-to-bottom, run the first
 * whose `when` is true (or the else/when-less arm), and record `takenArm`
 * so the run-tree projection can show which arm ran without re-evaluating.
 */
export async function executeChoose(ctx: StepContext, step: ChooseStep, walk: NestedWalker): Promise<StepOutcome> {
  let taken = -1;

  for (let a = 0; a < step.choose.length; a++) {
    const arm = step.choose[a];
    if (!arm) continue;
    const isElse = arm.else === true || arm.when === undefined;
    if (isElse || (await renderCondition(arm.when as string, ctx.scope))) {
      taken = a;
      break;
    }
  }

  // No arm matched and no else arm exists — succeed with null output.
  if (taken < 0) {
    return { type: 'completed', output: null, scratch: { takenArm: -1 } } as StepOutcome & {
      scratch: Record<string, unknown>;
    };
  }

  const arm = step.choose[taken];
  if (!arm) {
    return { type: 'completed', output: null, scratch: { takenArm: -1 } } as StepOutcome & {
      scratch: Record<string, unknown>;
    };
  }

  const result = await walk(arm.steps, `${ctx.stepPath}.choose.${taken}.steps`, ctx.scope);

  if (result.type === 'parked') {
    return {
      type: 'wait',
      wait: { kind: 'timer', wakeAt: null },
      scratch: { takenArm: taken },
    };
  }

  if (result.type === 'failed') {
    return { type: 'failed', error: result.error, retryable: false };
  }

  // Evaluate the block's own output expression (if any) against the inner scope.
  const output = step.output !== undefined ? await renderValue(step.output, result.scope) : null;

  return {
    type: 'completed',
    output: output ?? null,
    scratch: { takenArm: taken },
  } as StepOutcome & { scratch: Record<string, unknown> };
}
