/**
 * Names the `run_action` steps inside a retry body that are not known
 * idempotent, so `RetryBody`'s warning can name the offenders instead of
 * blanket-warning every retry — the engine's Decision-12 `idempotent` flag
 * only gates its own restart policy, not a user-facing retry, so this is
 * the only place a user learns which of their steps will double-fire.
 */
import type { ActionCatalogEntry, AutomationStep, RunActionStep } from '../contract';

function collectRunActionSteps(steps: AutomationStep[]): RunActionStep[] {
  const found: RunActionStep[] = [];
  for (const step of steps) {
    if (step.kind === 'run_action') {
      found.push(step);
    } else if (step.kind === 'if') {
      found.push(...collectRunActionSteps(step.then), ...collectRunActionSteps(step.otherwise));
    } else if (step.kind === 'repeat' || step.kind === 'loop' || step.kind === 'retry') {
      found.push(...collectRunActionSteps(step.steps));
    } else if (step.kind === 'parallel') {
      for (const branch of step.branches) found.push(...collectRunActionSteps(branch));
    }
  }
  return found;
}

/** Titles of the non-idempotent actions in `steps`, deduped and in first-seen order. An unresolved `actionId` (deleted/unrecognized action) counts as non-idempotent, named by its raw id. */
export function nonIdempotentActionTitles(steps: AutomationStep[], catalog: ActionCatalogEntry[]): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const step of collectRunActionSteps(steps)) {
    const action = catalog.find((a) => a.id === step.actionId);
    if (action?.idempotent === true) continue;
    const title = action?.title ?? step.actionId;
    if (!seen.has(title)) {
      seen.add(title);
      titles.push(title);
    }
  }
  return titles;
}
