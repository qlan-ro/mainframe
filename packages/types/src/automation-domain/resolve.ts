/**
 * Resolve a stored `TokenRef` back to its display descriptor, searching the
 * WHOLE definition regardless of position — this is the "does the producer
 * still exist at all" lookup a stored chip needs at render time (renaming
 * re-labels chips automatically; a deleted producer resolves to `null`,
 * which `validate.ts` turns into a pinned issue rather than a crash).
 * Contrast with `scopeAt`, which is position-aware (is this ref visible
 * HERE), not existence-aware.
 */
import type { ActionCatalogEntry, AutomationDefinition, AutomationStep, TokenRef } from '../automation.js';
import { TOKEN_STEP_BUILTIN, TOKEN_STEP_CURRENT, TOKEN_STEP_TRIGGER } from '../automation.js';
import { builtinTokens, stepProduces, triggerTokens, type TokenDescriptor } from './tokens.js';

export function findStep(steps: AutomationStep[], stepId: string): AutomationStep | null {
  for (const step of steps) {
    if (step.id === stepId) return step;
    if (step.kind === 'if') {
      const inThen = findStep(step.then, stepId);
      if (inThen) return inThen;
      const inOtherwise = findStep(step.otherwise, stepId);
      if (inOtherwise) return inOtherwise;
    }
    if (step.kind === 'repeat') {
      const inRepeat = findStep(step.steps, stepId);
      if (inRepeat) return inRepeat;
    }
  }
  return null;
}

/**
 * `current` refs need positional Repeat context this function doesn't have
 * (which Repeat block, if any) — callers with that context (`scopeAt`) resolve
 * `current` themselves; this always returns `null` for it.
 */
export function resolveTokenRef(
  definition: AutomationDefinition,
  catalog: ActionCatalogEntry[],
  ref: TokenRef,
): TokenDescriptor | null {
  if (ref.stepId === TOKEN_STEP_BUILTIN) {
    return builtinTokens().find((t) => t.ref.output === ref.output) ?? null;
  }
  if (ref.stepId === TOKEN_STEP_TRIGGER) {
    return triggerTokens(definition.triggers).find((t) => t.ref.output === ref.output) ?? null;
  }
  if (ref.stepId === TOKEN_STEP_CURRENT) {
    return null;
  }
  const step = findStep(definition.steps, ref.stepId);
  if (!step) return null;
  return stepProduces(step, catalog).find((t) => t.ref.output === ref.output) ?? null;
}
