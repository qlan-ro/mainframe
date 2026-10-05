/**
 * use-setup-advisor.section.test.ts
 *
 * D8: the advisor is a rail view now, not a sheet — `open`/`closeSheet` are
 * gone; `openSheet` shows the body by setting `ui-prefs.sidebarView`
 * ('advisor'). It must stay safe to hand directly to a DOM `onClick` — a
 * React synthetic event passed as the first argument must normalize to
 * `recommendations` when it DOES touch section, not leak through as a bogus
 * section (spec Decision 24, the "arity trap") — but `openSheet()` with no
 * argument at all now RESUMES the last section instead of resetting it
 * (same "resume where you left off" rule `openHost` follows for Automations).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSetupAdvisor } from '../use-setup-advisor';
import { useUiPrefs } from '@/store/ui-prefs';

const initialState = useSetupAdvisor.getState();

beforeEach(() => {
  useSetupAdvisor.setState(initialState, true);
  useUiPrefs.setState({ sidebarView: 'chats' });
});

describe('useSetupAdvisor — initial state', () => {
  it('starts on the recommendations section', () => {
    expect(useSetupAdvisor.getState().section).toBe('recommendations');
  });
});

describe('useSetupAdvisor — openSheet', () => {
  it('shows the Setup Advisor rail view, resuming recommendations when called with no argument', () => {
    useSetupAdvisor.getState().openSheet();

    expect(useUiPrefs.getState().sidebarView).toBe('advisor');
    expect(useSetupAdvisor.getState().section).toBe('recommendations');
  });

  it('shows the rail view on skills when called with "skills"', () => {
    useSetupAdvisor.getState().openSheet('skills');

    expect(useUiPrefs.getState().sidebarView).toBe('advisor');
    expect(useSetupAdvisor.getState().section).toBe('skills');
  });

  it('a bare reopen RESUMES the last section rather than resetting it', () => {
    useSetupAdvisor.getState().openSheet('skills');
    expect(useSetupAdvisor.getState().section).toBe('skills');

    useUiPrefs.setState({ sidebarView: 'chats' });
    useSetupAdvisor.getState().openSheet();

    expect(useUiPrefs.getState().sidebarView).toBe('advisor');
    expect(useSetupAdvisor.getState().section).toBe('skills');
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

    expect(useUiPrefs.getState().sidebarView).toBe('advisor');
    expect(useSetupAdvisor.getState().section).toBe('recommendations');
  });

  it('normalizes an unknown section string to recommendations', () => {
    useSetupAdvisor.getState().openSheet('nonsense' as never);

    expect(useSetupAdvisor.getState().section).toBe('recommendations');
  });
});

describe('useSetupAdvisor — setSection', () => {
  it('sets the section directly (the sidebar rows use this)', () => {
    useSetupAdvisor.getState().setSection('skills');
    expect(useSetupAdvisor.getState().section).toBe('skills');
  });
});
