/**
 * use-setup-advisor.test.ts (plan T11)
 *
 * The nav store gains a section dimension alongside its existing open/close
 * flag. Covers: the default state, `openSheet()`'s section-normalizing
 * argument (including the `onClick={openSheet}` event-argument trap, where
 * the click event itself would arrive as the first argument), `setSection`,
 * and that `closeSheet` never touches the section.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useSetupAdvisor } from '../use-setup-advisor';

beforeEach(() => {
  useSetupAdvisor.setState({ open: false, section: 'recommendations' });
});

describe('useSetupAdvisor — default state', () => {
  it('starts closed on the recommendations section', () => {
    const state = useSetupAdvisor.getState();
    expect(state.open).toBe(false);
    expect(state.section).toBe('recommendations');
  });
});

describe('useSetupAdvisor — openSheet section argument', () => {
  it('opens on recommendations when called with no argument', () => {
    useSetupAdvisor.getState().openSheet();
    expect(useSetupAdvisor.getState()).toMatchObject({ open: true, section: 'recommendations' });
  });

  it('opens on skills when called with "skills"', () => {
    useSetupAdvisor.getState().openSheet('skills');
    expect(useSetupAdvisor.getState()).toMatchObject({ open: true, section: 'skills' });
  });

  it('normalizes any non-"skills" argument to recommendations (the onClick={openSheet} trap)', () => {
    // A DOM click handler wired as `onClick={openSheet}` passes the
    // MouseEvent as the first argument — openSheet must not mistake it (or
    // any other non-'skills' value) for a section name.
    const fakeClickEvent = { type: 'click' } as unknown as never;
    useSetupAdvisor.getState().openSheet(fakeClickEvent);
    expect(useSetupAdvisor.getState()).toMatchObject({ open: true, section: 'recommendations' });
  });
});

describe('useSetupAdvisor — setSection', () => {
  it('changes only the section while open, leaving open untouched', () => {
    useSetupAdvisor.getState().openSheet('recommendations');
    useSetupAdvisor.getState().setSection('skills');

    expect(useSetupAdvisor.getState()).toMatchObject({ open: true, section: 'skills' });
  });
});

describe('useSetupAdvisor — closeSheet', () => {
  it('closes without changing the current section', () => {
    useSetupAdvisor.getState().openSheet('skills');
    useSetupAdvisor.getState().closeSheet();

    expect(useSetupAdvisor.getState()).toMatchObject({ open: false, section: 'skills' });
  });
});
