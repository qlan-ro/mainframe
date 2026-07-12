/**
 * Scope walk — split out of tokens.ts (which owns token *shape*: builtins,
 * trigger tokens, and per-step `stepProduces`) to stay under the file-size
 * limit. `scopeAt` walks the step tree to answer "which tokens are visible
 * right here", including Repeat's `Current item` token, which only exists
 * inside that block's own `steps` (never returned by `stepProduces`).
 */
import type { ActionCatalogEntry, AutomationDefinition, AutomationStep, TokenRef } from '../automation.js';
import { TOKEN_STEP_CURRENT } from '../automation.js';
import { builtinTokens, triggerTokens, stepProduces, type TokenDescriptor } from './tokens.js';

/** Synthesize Repeat's `Current item` token from the list token its `items` ref points to (visible only inside `steps`; never returned by `stepProduces`). */
function currentItemToken(itemsRef: TokenRef, scope: TokenDescriptor[]): TokenDescriptor | null {
  const listToken = scope.find((t) => t.ref.stepId === itemsRef.stepId && t.ref.output === itemsRef.output);
  if (!listToken) return null;
  const descriptor: TokenDescriptor = {
    ref: { stepId: TOKEN_STEP_CURRENT, output: 'item' },
    label: 'Current item',
    type: 'text',
    sourceKind: 'item',
    source: 'Repeat',
  };
  if (listToken.fields) descriptor.fields = listToken.fields;
  return descriptor;
}

interface WalkResult {
  found: boolean;
  scope: TokenDescriptor[];
}

function walk(
  steps: AutomationStep[],
  scope: TokenDescriptor[],
  targetStepId: string | null,
  catalog: ActionCatalogEntry[],
): WalkResult {
  let running = scope;
  for (const step of steps) {
    if (step.id === targetStepId) return { found: true, scope: running };
    if (step.kind === 'if') {
      const thenResult = walk(step.then, running, targetStepId, catalog);
      if (thenResult.found) return thenResult;
      const otherwiseResult = walk(step.otherwise, running, targetStepId, catalog);
      if (otherwiseResult.found) return otherwiseResult;
      running = running.concat(stepProduces(step, catalog));
    } else if (step.kind === 'repeat') {
      const itemToken = currentItemToken(step.items, running);
      const innerScope = itemToken ? running.concat([itemToken]) : running;
      const repeatResult = walk(step.steps, innerScope, targetStepId, catalog);
      if (repeatResult.found) return repeatResult;
      // Isolated: no leak after the block, even though repeatResult.scope may hold Current item.
    } else {
      running = running.concat(stepProduces(step, catalog));
    }
  }
  return { found: false, scope: running };
}

/**
 * Tokens visible immediately before `targetStepId` — trigger tokens + built-ins
 * + every token produced by earlier siblings at this level or an ancestor.
 * Pass `null` to get the scope after the ENTIRE top-level recipe (e.g. for a
 * step about to be appended at the end).
 */
export function scopeAt(
  definition: AutomationDefinition,
  catalog: ActionCatalogEntry[],
  targetStepId: string | null,
): TokenDescriptor[] {
  const base = builtinTokens().concat(triggerTokens(definition.triggers));
  return walk(definition.steps, base, targetStepId, catalog).scope;
}
