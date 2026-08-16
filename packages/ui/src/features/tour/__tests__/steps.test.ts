/**
 * resolveTourPlan — anchor-driven step resolution.
 *
 * The tour only ever runs on an empty workspace, and that workspace has two
 * shapes: the welcome screen (projects exist, none picked for this draft) and
 * the first-run hero (no projects at all). Each conceptual step declares its
 * variants in anchor-preference order; these tests pin which variant each shape
 * resolves to, and that the resolved plan is the counter the label can trust.
 */
import { describe, it, expect } from 'vitest';
import { resolveTourPlan, TOUR_STEP_COUNT } from '../steps';

/** Builds a `hasAnchor` predicate over a fixed set of present anchors. */
function anchors(...present: string[]) {
  const set = new Set(present);
  return (target: string) => set.has(target);
}

const WELCOME = anchors('sessions', 'project', 'prompt', 'workspace');
const FIRST_RUN = anchors('sessions', 'add-project', 'prompt', 'workspace');
const COMPOSER_OPEN = anchors('sessions', 'project', 'prompt', 'composer', 'workspace');

describe('resolveTourPlan', () => {
  it('resolves all four steps on the welcome screen', () => {
    const plan = resolveTourPlan(WELCOME);
    expect(plan.map((s) => s.target)).toEqual(['sessions', 'project', 'prompt', 'workspace']);
    expect(plan).toHaveLength(TOUR_STEP_COUNT);
  });

  it('resolves all four steps on the first-run hero, swapping in its add-project variant', () => {
    const plan = resolveTourPlan(FIRST_RUN);
    expect(plan.map((s) => s.target)).toEqual(['sessions', 'add-project', 'prompt', 'workspace']);
    expect(plan[1]?.title).toBe('Add your first project');
  });

  it('prefers the composer variant over the prompt fallback once the composer is mounted', () => {
    const plan = resolveTourPlan(COMPOSER_OPEN);
    expect(plan.map((s) => s.target)).toEqual(['sessions', 'project', 'composer', 'workspace']);
  });

  it('drops a step whose every variant is unanchorable, so the count never overstates', () => {
    const plan = resolveTourPlan(anchors('sessions', 'workspace'));
    expect(plan.map((s) => s.target)).toEqual(['sessions', 'workspace']);
  });

  it('returns an empty plan when nothing is anchorable', () => {
    expect(resolveTourPlan(anchors())).toEqual([]);
  });

  it('gives every step a title, a body and a side', () => {
    for (const step of resolveTourPlan(WELCOME)) {
      expect(step.title).not.toBe('');
      expect(step.body).not.toBe('');
      expect(['right', 'above', 'below']).toContain(step.side);
    }
  });
});
