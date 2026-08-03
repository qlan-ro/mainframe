/**
 * use-setup-advisor.section.test.ts (spec AC 3; plan T30)
 *
 * The nav store gains a `section` alongside `open`. `openSheet` must stay
 * safe to hand directly to a DOM `onClick` — a React synthetic event passed
 * as the first argument must normalize to `recommendations`, not leak
 * through as a bogus section (spec Decision 24, the "arity trap").
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSetupAdvisor } from '../use-setup-advisor';

const initialState = useSetupAdvisor.getState();

beforeEach(() => {
  useSetupAdvisor.setState(initialState, true);
});

describe('useSetupAdvisor — initial state', () => {
  it('starts closed on the recommendations section', () => {
    const state = useSetupAdvisor.getState();
    expect(state.open).toBe(false);
    expect(state.section).toBe('recommendations');
  });
});

describe('useSetupAdvisor — openSheet', () => {
  it('opens on recommendations when called with no argument', () => {
    useSetupAdvisor.getState().openSheet();

    const state = useSetupAdvisor.getState();
    expect(state.open).toBe(true);
    expect(state.section).toBe('recommendations');
  });

  it('opens on skills when called with "skills"', () => {
    useSetupAdvisor.getState().openSheet('skills');

    const state = useSetupAdvisor.getState();
    expect(state.open).toBe(true);
    expect(state.section).toBe('skills');
  });

  it('normalizes a React-synthetic-event-shaped argument to recommendations', () => {
    const fakeEvent = {
      type: 'click',
      target: {},
      currentTarget: {},
      preventDefault: () => {},
      stopPropagation: () => {},
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useSetupAdvisor.getState().openSheet(fakeEvent as any);

    const state = useSetupAdvisor.getState();
    expect(state.open).toBe(true);
    expect(state.section).toBe('recommendations');
  });

  it('normalizes an unknown section string to recommendations', () => {
    useSetupAdvisor.getState().openSheet('nonsense' as never);

    const state = useSetupAdvisor.getState();
    expect(state.open).toBe(true);
    expect(state.section).toBe('recommendations');
  });
});

describe('useSetupAdvisor — closeSheet leaves section untouched, but no persistence on reopen', () => {
  it('keeps the last section across close, then a bare reopen still lands on recommendations', () => {
    useSetupAdvisor.getState().openSheet('skills');
    expect(useSetupAdvisor.getState().section).toBe('skills');

    useSetupAdvisor.getState().closeSheet();
    expect(useSetupAdvisor.getState().open).toBe(false);
    expect(useSetupAdvisor.getState().section).toBe('skills');

    useSetupAdvisor.getState().openSheet();
    const state = useSetupAdvisor.getState();
    expect(state.open).toBe(true);
    expect(state.section).toBe('recommendations');
  });
});
