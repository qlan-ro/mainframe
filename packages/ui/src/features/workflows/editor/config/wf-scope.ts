/**
 * Pure magic-variable scope analysis for the workflow builder's config forms.
 *
 * `scopeForPath` walks the draft's step tree along a `WfStepPath` and returns
 * every named source (`${...}` expression) visible at that point: earlier
 * siblings' outputs, form-answer keys, workflow inputs/vars, upstream `set`
 * keys, and enclosing `foreach` loop variables. See docs/plans/2026-07-09-
 * workflow-step-config-plan.md Task 9 for the encoding and ordering rules.
 */

import type { WfDraft, WfStep } from '../wf-draft-types';

export type WfScopeSource =
  | { kind: 'step'; expr: string; label: string; id: string }
  | { kind: 'answer'; expr: string; label: string; id: string; key: string }
  | { kind: 'input'; expr: string; label: string; name: string }
  | { kind: 'var'; expr: string; label: string; key: string }
  | { kind: 'loop'; expr: string; label: string; as: string };

/**
 * A plain number selects a step in the current list. `{ arm: k }` enters a
 * `choose` arm's steps; `{ branch: name }` enters a `parallel` branch's steps.
 * A `foreach` body is entered with a plain number directly — it has exactly
 * one, unnamed child list, so no selector token precedes it.
 */
export type WfStepPath = Array<number | { branch: string } | { arm: number }>;

function exprOf(inner: string): string {
  return `\${ ${inner} }`;
}

function answerKeys(step: WfStep): WfScopeSource[] {
  if (step.kind !== 'form') return [];
  return step.form.fields.map((field) => ({
    kind: 'answer',
    id: step.id,
    key: field.key,
    label: field.label ?? field.key,
    expr: exprOf(`steps.${step.id}.output.${field.key}`),
  }));
}

function collectSiblings(steps: WfStep[], uptoIndex: number): WfScopeSource[] {
  const out: WfScopeSource[] = [];
  for (let i = 0; i < uptoIndex; i++) {
    const step = steps[i];
    if (!step) continue;
    out.push({
      kind: 'step',
      id: step.id,
      label: step.name ?? step.id,
      expr: exprOf(`steps.${step.id}.output`),
    });
    out.push(...answerKeys(step));
    if (step.kind === 'set') {
      for (const key of Object.keys(step.set)) {
        out.push({ kind: 'var', key, label: key, expr: exprOf(`vars.${key}`) });
      }
    }
  }
  return out;
}

function childListFor(step: WfStep, selector: { branch: string } | { arm: number }): WfStep[] | undefined {
  if (step.kind === 'choose' && 'arm' in selector) {
    return step.arms[selector.arm]?.steps;
  }
  if (step.kind === 'parallel' && 'branch' in selector) {
    return step.branches[selector.branch];
  }
  return undefined;
}

export function scopeForPath(draft: WfDraft, path: WfStepPath): WfScopeSource[] {
  const out: WfScopeSource[] = [];

  for (const input of draft.inputs) {
    out.push({
      kind: 'input',
      name: input.name,
      label: input.title ?? input.name,
      expr: exprOf(`inputs.${input.name}`),
    });
  }
  for (const v of draft.vars) {
    out.push({ kind: 'var', key: v.key, label: v.key, expr: exprOf(`vars.${v.key}`) });
  }

  let steps: WfStep[] = draft.steps;
  let i = 0;
  while (i < path.length) {
    const selector = path[i];
    if (typeof selector !== 'number') break; // malformed: a token without a preceding index

    out.push(...collectSiblings(steps, selector));
    const step = steps[selector];
    if (!step) break;
    i++;
    if (i >= path.length) break; // path ends here — addressing `step` itself, no descent

    if (step.kind === 'foreach') {
      out.push({ kind: 'loop', as: step.as, label: step.as, expr: exprOf(step.as) });
      steps = step.steps;
      continue; // next path element is a plain number into this list
    }

    const next = path[i];
    if (next === undefined || typeof next === 'number') break; // malformed: composite step needs a selector token
    const list = childListFor(step, next);
    if (!list) break;
    steps = list;
    i++;
  }

  return out;
}
