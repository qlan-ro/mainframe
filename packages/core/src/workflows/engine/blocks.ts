import type { ChooseStep, ForeachStep } from '../dsl/types.js';
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

/** Derive a short display label from one iteration item (≤40 chars). */
function labelOf(item: unknown): string {
  if (item !== null && typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    const raw = obj['id'] ?? obj['number'] ?? obj['name'];
    if (raw !== undefined) return String(raw).slice(0, 40);
  }
  return String(item).slice(0, 40);
}

/**
 * Execute a `foreach` block: render the expression to an array, then walk
 * each item's step sequence at path `<stepPath>#<i>.steps`.
 * Scratch records `iterations` labels so the run-tree projection can title tabs.
 */
export async function executeForeach(ctx: StepContext, step: ForeachStep, walk: NestedWalker): Promise<StepOutcome> {
  const items = await renderValue(step.foreach, ctx.scope);
  if (!Array.isArray(items)) {
    return {
      type: 'failed',
      error: `foreach '${step.id}' must evaluate to an array, got ${typeof items}`,
      retryable: false,
    };
  }

  const as = step.as ?? 'item';
  const collected: unknown[] = [];

  for (let i = 0; i < items.length; i++) {
    const iterScope: Scope = { ...ctx.scope, [as]: items[i], index: i };
    const result = await walk(step.steps, `${ctx.stepPath}#${i}.steps`, iterScope);

    if (result.type === 'parked') {
      return { type: 'wait', wait: { kind: 'timer', wakeAt: null } };
    }
    if (result.type === 'failed') {
      return { type: 'failed', error: `iteration ${i}: ${result.error}`, retryable: false };
    }

    if (step.output !== undefined) {
      collected.push(await renderValue(step.output, result.scope));
    } else {
      const lastStep = step.steps[step.steps.length - 1];
      const bound = lastStep ? (result.scope[lastStep.id] as { output: unknown } | undefined) : undefined;
      collected.push(bound?.output ?? null);
    }
  }

  const iterations = items.map((item, i) => ({ index: i, label: labelOf(item) }));
  return {
    type: 'completed',
    output: collected,
    scratch: { iterations },
  } as StepOutcome & { scratch: Record<string, unknown> };
}
