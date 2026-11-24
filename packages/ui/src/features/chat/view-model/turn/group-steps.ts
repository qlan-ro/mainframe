/** Folds a long run of reads and searches into one "Explored" step. Pure. */
import { EXPLORE_KINDS, toolKind } from './tool-kind';
import { resolveToolStatus } from './tool-status';
import type { TurnUnit } from './types';

/** Shorter runs read faster as rows than as a row to open. */
export const EXPLORE_MIN = 4;

export interface SingleStep {
  readonly type: 'single';
  readonly key: string;
  readonly unit: TurnUnit;
}
export interface ExploreStep {
  readonly type: 'explore';
  readonly key: string;
  readonly units: readonly TurnUnit[];
}

export type Step = SingleStep | ExploreStep;

function explores({ part }: TurnUnit, pending: ReadonlySet<string>): boolean {
  return (
    part.type === 'tool-call' &&
    EXPLORE_KINDS.has(toolKind(part.toolName)) &&
    resolveToolStatus(part, pending) === 'success'
  );
}

/**
 * `open`: the turn may still add to these steps, so its last run stays as rows
 * until something follows it, rather than folding under the viewer's eyes.
 */
export function groupSteps(units: readonly TurnUnit[], pending: ReadonlySet<string>, open = false): Step[] {
  const steps: Step[] = [];
  let run: TurnUnit[] = [];
  const flush = (last: boolean) => {
    if (run.length >= EXPLORE_MIN && !(last && open)) steps.push({ type: 'explore', key: run[0]!.key, units: run });
    else for (const unit of run) steps.push({ type: 'single', key: unit.key, unit });
    run = [];
  };
  for (const unit of units) {
    if (explores(unit, pending)) {
      run.push(unit);
      continue;
    }
    flush(false);
    steps.push({ type: 'single', key: unit.key, unit });
  }
  flush(true);
  return steps;
}
