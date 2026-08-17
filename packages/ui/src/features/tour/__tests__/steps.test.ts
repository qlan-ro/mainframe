/**
 * resolveTourPlan — anchor-driven step resolution.
 *
 * The tour arms in one state (a project exists, no sessions yet), where every
 * step has a live anchor. Resolution stays anchor-driven anyway, so that the
 * label can only ever count steps the tour can actually point at — the defect
 * that made the old tour say "Step 1 of 4" and then jump to "Step 4 of 4".
 */
import { describe, it, expect } from 'vitest';
import { resolveTourPlan, TOUR_STEP_COUNT } from '../steps';

/** Every anchor the armed workspace carries, verified against the running app. */
const ARMED_ANCHORS = [
  'add-project',
  'new-session',
  'new-session-row',
  'new-session-tab',
  'sessions-list',
  'session-tabs',
  'session-rail',
  'workspace',
  'search',
  'kanban',
  'automations',
  'daemon',
];

/** Builds a `hasAnchor` predicate over a fixed set of present anchors. */
function anchors(...present: string[]) {
  const set = new Set(present);
  return (target: string) => set.has(target);
}

describe('resolveTourPlan', () => {
  it('resolves the full tour in the state it arms in', () => {
    const plan = resolveTourPlan(anchors(...ARMED_ANCHORS));
    expect(plan).toHaveLength(TOUR_STEP_COUNT);
    expect(plan.map((s) => s.target)).toEqual([
      'add-project',
      'new-session',
      'sessions-list',
      'session-rail',
      'workspace',
      'search',
      'kanban',
      'automations',
      'daemon',
    ]);
  });

  it('drops an unanchorable step so the count never overstates', () => {
    const plan = resolveTourPlan(anchors('add-project', 'new-session', 'daemon'));
    expect(plan.map((s) => s.target)).toEqual(['add-project', 'new-session', 'daemon']);
  });

  it('returns an empty plan when nothing is anchorable', () => {
    expect(resolveTourPlan(anchors())).toEqual([]);
  });

  it('marks the secondary locations for the affordances that have more than one', () => {
    const plan = resolveTourPlan(anchors(...ARMED_ANCHORS));
    const byTarget = Object.fromEntries(plan.map((s) => [s.target, s]));
    expect(byTarget['new-session']?.also).toEqual(['new-session-row', 'new-session-tab']);
    expect(byTarget['sessions-list']?.also).toEqual(['session-tabs']);
    // A single-location step must not claim ghosts it has no anchors for.
    expect(byTarget['kanban']?.also).toBeUndefined();
  });

  it('gives every step a title, a body and a side', () => {
    for (const step of resolveTourPlan(anchors(...ARMED_ANCHORS))) {
      expect(step.title).not.toBe('');
      expect(step.body).not.toBe('');
      expect(['left', 'right', 'above', 'below']).toContain(step.side);
    }
  });
});
