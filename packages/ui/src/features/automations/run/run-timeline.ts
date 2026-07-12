/**
 * run-timeline — pure helpers shared by RunView/RunStepRow/RunRepeatGroup.
 *
 * A `AutomationTimelineEntry` (contract §2's checkpoint `steps` map,
 * flattened) carries no display label, no "kept going" flag, and no
 * iteration tree — those are all derived here from the run's automation
 * definition, never invented on the entry itself:
 * - `entryLabel` cross-references the definition's step (frozen at run
 *   start in the real engine; the UI resolves against the current
 *   definition until Phase 6 exposes the checkpoint's own snapshot) via
 *   `domain/tokens.ts`'s `stepLabel`, falling back to the verb label when
 *   the step can't be found (e.g. deleted since the run).
 * - "Kept going" is `status:'failed'` on an entry whose OWN step definition
 *   has `keepGoing: true` — the wire has no separate flag for it.
 * - Repeat fan-out entries use `stepRef = '<innerStepId>#<iteration>'`
 *   (contract §2); `groupRepeatIterations` buckets them by iteration for
 *   `RunRepeatGroup` to render as nested children under the repeat's own
 *   entry. `if` branches need no such grouping — their entries use their
 *   own plain stepId and render as ordinary flat, top-level rows.
 * - `repeatProgressLabel` gives the repeat's own top-level row the
 *   iteration identity the artboard bakes into its mock title ("Repeat for
 *   each · PR 3 of 3"): the wire has no total-item count mid-run, so it
 *   reports the current ordinal while running and a completed count once
 *   terminal, rather than fabricate an "N of M" the UI can't verify.
 */
import type { ActionCatalogEntry, AutomationStep, AutomationTimelineEntry, RepeatBlock } from '../contract';
import { findStepById, stepLabel } from '../domain/tokens';
import { VERB_META } from '../editor/verb-meta';

/** `null` while the entry has no closed start/end (still running or waiting). */
export function formatDuration(startedAt?: number, finishedAt?: number): string | null {
  if (startedAt == null || finishedAt == null) return null;
  const ms = Math.max(0, finishedAt - startedAt);
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function isKeptGoing(entry: AutomationTimelineEntry, steps: AutomationStep[]): boolean {
  if (entry.status !== 'failed') return false;
  return findStepById(steps, entry.stepId)?.keepGoing === true;
}

export function entryLabel(
  entry: AutomationTimelineEntry,
  steps: AutomationStep[],
  catalog: ActionCatalogEntry[],
): string {
  const step = findStepById(steps, entry.stepId);
  return step ? stepLabel(step, catalog) : VERB_META[entry.kind].label;
}

export interface RepeatIterationGroup {
  iteration: number;
  entries: AutomationTimelineEntry[];
}

/** Buckets a Repeat block's fan-out entries by iteration number, in the order they appear in `timeline`. */
export function groupRepeatIterations(
  timeline: AutomationTimelineEntry[],
  repeatStep: RepeatBlock,
): RepeatIterationGroup[] {
  const innerIds = new Set(repeatStep.steps.map((s) => s.id));
  const byIteration = new Map<number, AutomationTimelineEntry[]>();

  for (const entry of timeline) {
    const hashIndex = entry.stepRef.indexOf('#');
    if (hashIndex === -1) continue;
    const baseId = entry.stepRef.slice(0, hashIndex);
    if (!innerIds.has(baseId)) continue;
    const iteration = Number(entry.stepRef.slice(hashIndex + 1));
    if (!Number.isFinite(iteration)) continue;
    const group = byIteration.get(iteration);
    if (group) group.push(entry);
    else byIteration.set(iteration, [entry]);
  }

  return Array.from(byIteration.entries())
    .sort(([a], [b]) => a - b)
    .map(([iteration, entries]) => ({ iteration, entries }));
}

/**
 * Iteration progress for a Repeat block's own top-level entry — `null`
 * before its first iteration lands. `null` return means the caller renders
 * the plain verb label with no suffix.
 */
export function repeatProgressLabel(
  entry: AutomationTimelineEntry,
  timeline: AutomationTimelineEntry[],
  repeatStep: RepeatBlock,
): string | null {
  const groups = groupRepeatIterations(timeline, repeatStep);
  if (groups.length === 0) return null;
  if (entry.status === 'running') {
    return `Iteration ${groups[groups.length - 1]!.iteration}`;
  }
  return `${groups.length} iteration${groups.length === 1 ? '' : 's'}`;
}
