// packages/core/src/workflows/dsl/verify.ts
import type { StepDef, WorkflowDef, ChooseStep, ForeachStep, ParallelStep } from './types.js';
import { stepKind } from './types.js';
import { extractRefRoots } from '../template/render.js';

export interface VerifyError {
  stepId: string | null;
  message: string;
}

/** Namespace roots that are always in scope — not step ids. */
const NAMESPACES = new Set(['inputs', 'vars', 'trigger', 'run']);

/**
 * Collect every template string inside a step's own config.
 * Does NOT descend into nested block step arrays — those are walked separately
 * with their own scope in verifySequence.
 */
function ownTemplates(step: StepDef): string[] {
  const strings: string[] = [];

  const collect = (v: unknown): void => {
    if (typeof v === 'string') {
      strings.push(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(collect);
      return;
    }
    if (v !== null && typeof v === 'object') {
      Object.values(v).forEach(collect);
    }
  };

  const kind = stepKind(step);
  if (kind === 'connector') collect((step as Extract<StepDef, { connector: string }>).with);
  if (kind === 'set') collect((step as Extract<StepDef, { set: Record<string, unknown> }>).set);
  if (kind === 'agent') collect((step as Extract<StepDef, { agent: { prompt: string } }>).agent.prompt);
  if (kind === 'question') {
    const q = (step as Extract<StepDef, { question: { title: string; fields: unknown[] } }>).question;
    collect(q.title);
    q.fields.forEach((f) => {
      if (f !== null && typeof f === 'object') collect(f);
    });
  }
  if (kind === 'choose') {
    const s = step as ChooseStep;
    s.choose.forEach((arm) => {
      if (arm.when !== undefined) collect(arm.when);
    });
  }
  if (kind === 'foreach') collect((step as ForeachStep).foreach);
  if (kind === 'call') collect((step as Extract<StepDef, { call: string; with?: Record<string, unknown> }>).with);

  return strings;
}

function checkRefs(
  templates: string[],
  visible: Set<string>,
  loopVars: Set<string>,
  stepId: string | null,
  errors: VerifyError[],
): void {
  for (const t of templates) {
    for (const root of extractRefRoots(t)) {
      if (NAMESPACES.has(root) || visible.has(root) || loopVars.has(root) || root.startsWith('$')) continue;
      errors.push({ stepId, message: `'${root}' is not in scope${stepId ? ` (step '${stepId}')` : ''}` });
    }
  }
}

/**
 * Walk a sequence of steps, accumulating visible ids left-to-right.
 * Returns the set of visible ids after the sequence (outer + all steps in this sequence).
 * Inner block ids do NOT propagate back up.
 */
function verifySequence(
  steps: StepDef[],
  inherited: Set<string>,
  loopVars: Set<string>,
  errors: VerifyError[],
): Set<string> {
  const visible = new Set(inherited);
  const localIds = new Set<string>();

  for (const step of steps) {
    if (localIds.has(step.id)) {
      errors.push({ stepId: step.id, message: `duplicate step id '${step.id}' in scope` });
    }
    localIds.add(step.id);

    checkRefs(ownTemplates(step), visible, loopVars, step.id, errors);

    const kind = stepKind(step);
    if (kind === 'choose') {
      (step as ChooseStep).choose.forEach((arm) => {
        verifySequence(arm.steps, visible, loopVars, errors);
      });
    } else if (kind === 'foreach') {
      const s = step as ForeachStep;
      const bodyLoop = new Set([...loopVars, s.as ?? 'item', 'index']);
      verifySequence(s.steps, visible, bodyLoop, errors);
    } else if (kind === 'parallel') {
      Object.values((step as ParallelStep).parallel).forEach((branch) => {
        verifySequence(branch, visible, loopVars, errors);
      });
    }

    // This step's id becomes visible to later siblings only — inner ids never escape.
    visible.add(step.id);
  }

  return visible;
}

/** Verify a parsed WorkflowDef for scope and reference correctness. Returns all errors found. */
export function verifyWorkflow(def: WorkflowDef): VerifyError[] {
  const errors: VerifyError[] = [];
  const rootScope = verifySequence(def.steps, new Set(), new Set(), errors);

  if (def.outputs) {
    checkRefs(Object.values(def.outputs), rootScope, new Set(), null, errors);
  }

  if (def.vars) {
    const varTemplates = Object.values(def.vars).filter((v): v is string => typeof v === 'string');
    checkRefs(varTemplates, new Set(), new Set(), null, errors);
  }

  return errors;
}
