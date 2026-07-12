// packages/core/src/automations/definition/validate.ts
//
// Static scope + reference validator (contract Decision 8). This is
// separate from AutomationDefinitionSchema (Task 4): the schema checks
// *shape*, this checks *meaning* — which tokens are reachable from which
// step. Errors are plain-language and per-step (spec §10: "shown on the
// offending step, not in a panel"), not generic type-mismatch text.
import {
  TOKEN_STEP_BUILTIN,
  TOKEN_STEP_CURRENT,
  TOKEN_STEP_TRIGGER,
  type AutomationDefinition,
  type AutomationStep,
  type ChipText,
  type TokenRef,
} from '@qlan-ro/mainframe-types';

export interface ScopeError {
  stepId: string | null;
  message: string;
}

/** actionId -> its valid output names. Omit entirely to skip run_action output-name checks. */
export type CatalogOutputs = Record<string, string[]>;

interface StepScope {
  /** Known output names for the step, or null when the caller didn't supply enough info to check (accept any name). */
  outputs: string[] | null;
}

export function validateScopes(def: AutomationDefinition, catalogOutputs?: CatalogOutputs): ScopeError[] {
  const errors: ScopeError[] = [];
  const allStepIds = new Set<string>();
  collectStepIds(def.steps, allStepIds, errors);
  walkSteps(def.steps, new Map(), false, allStepIds, catalogOutputs, errors);
  return errors;
}

/** Depth-first pre-pass: every step id that exists anywhere, and duplicate-id errors. */
function collectStepIds(steps: AutomationStep[], seen: Set<string>, errors: ScopeError[]): void {
  for (const step of steps) {
    if (seen.has(step.id)) {
      errors.push({ stepId: step.id, message: `Step id '${step.id}' is used more than once in this automation.` });
    } else {
      seen.add(step.id);
    }
    if (step.kind === 'if') {
      collectStepIds(step.then, seen, errors);
      collectStepIds(step.otherwise, seen, errors);
    } else if (step.kind === 'repeat') {
      collectStepIds(step.steps, seen, errors);
    }
  }
}

/**
 * Walks a sequence of steps left to right, threading a visible-token map.
 * Returns the scope after the sequence — If merges both branches' step
 * outputs back into the returned scope (Decision 8: visible to later
 * siblings); Repeat's inner steps are walked but never merged back (their
 * outputs aren't addressable once the block ends).
 */
function walkSteps(
  steps: AutomationStep[],
  inherited: Map<string, StepScope>,
  insideRepeat: boolean,
  allStepIds: Set<string>,
  catalogOutputs: CatalogOutputs | undefined,
  errors: ScopeError[],
): Map<string, StepScope> {
  const scope = new Map(inherited);
  for (const step of steps) {
    for (const ref of collectOwnTokenRefs(step)) {
      checkTokenRef(ref, step.id, scope, insideRepeat, allStepIds, catalogOutputs, errors);
    }

    if (step.kind === 'if') {
      const thenScope = walkSteps(step.then, scope, insideRepeat, allStepIds, catalogOutputs, errors);
      const otherwiseScope = walkSteps(step.otherwise, scope, insideRepeat, allStepIds, catalogOutputs, errors);
      mergeNewEntries(scope, thenScope);
      mergeNewEntries(scope, otherwiseScope);
    } else if (step.kind === 'repeat') {
      walkSteps(step.steps, scope, true, allStepIds, catalogOutputs, errors);
    }

    scope.set(step.id, { outputs: outputsForStep(step, catalogOutputs) });
  }
  return scope;
}

function mergeNewEntries(target: Map<string, StepScope>, source: Map<string, StepScope>): void {
  for (const [id, value] of source) {
    if (!target.has(id)) target.set(id, value);
  }
}

function checkTokenRef(
  ref: TokenRef,
  ownerStepId: string,
  scope: Map<string, StepScope>,
  insideRepeat: boolean,
  allStepIds: Set<string>,
  catalogOutputs: CatalogOutputs | undefined,
  errors: ScopeError[],
): void {
  if (ref.stepId === TOKEN_STEP_TRIGGER || ref.stepId === TOKEN_STEP_BUILTIN) return;

  if (ref.stepId === TOKEN_STEP_CURRENT) {
    if (!insideRepeat)
      errors.push({ stepId: ownerStepId, message: '⟨Current item⟩ is only available inside a Repeat block.' });
    return;
  }

  const known = scope.get(ref.stepId);
  if (!known) {
    const message = allStepIds.has(ref.stepId)
      ? 'This step uses an answer from a step that comes later — move it below.'
      : `This step refers to a step that doesn't exist ('${ref.stepId}').`;
    errors.push({ stepId: ownerStepId, message });
    return;
  }

  if (known.outputs !== null && !known.outputs.includes(ref.output)) {
    errors.push({ stepId: ownerStepId, message: `'${ref.output}' is not an answer produced by step '${ref.stepId}'.` });
  }
}

function outputsForStep(step: AutomationStep, catalogOutputs: CatalogOutputs | undefined): string[] | null {
  switch (step.kind) {
    case 'ask_agent':
      return ['result', 'chatId', ...(step.expects?.map((e) => e.key) ?? [])];
    case 'ask_me':
      return step.fields.map((f) => f.key);
    case 'run_action':
      return catalogOutputs ? (catalogOutputs[step.actionId] ?? []) : null;
    case 'notify':
    case 'if':
    case 'repeat':
      return [];
  }
}

function collectOwnTokenRefs(step: AutomationStep): TokenRef[] {
  switch (step.kind) {
    case 'ask_agent':
      return [...chipTokens(step.prompt), ...(step.worktree ? chipTokens(step.worktree.branchName) : [])];
    case 'ask_me':
      return [];
    case 'run_action':
      return Object.values(step.params).flatMap(chipTokens);
    case 'notify':
      return chipTokens(step.message);
    case 'if':
      return step.conditions.map((c) => c.token);
    case 'repeat':
      return [step.items];
  }
}

function chipTokens(text: ChipText): TokenRef[] {
  return text.filter((part): part is { token: TokenRef } => typeof part !== 'string').map((part) => part.token);
}
