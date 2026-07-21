import { beforeEach, describe, expect, it } from 'vitest';
import { useAutomationsNav } from '../use-automations-nav';

type AutomationsNavState = ReturnType<typeof useAutomationsNav.getState>;

type SetterCase = {
  name: string;
  setup: Partial<AutomationsNavState>;
  act: (s: AutomationsNavState) => void;
  expected: Partial<AutomationsNavState>;
};

const SETTER_CASES: SetterCase[] = [
  {
    name: 'openHost opens the host',
    setup: {},
    act: (s) => s.openHost(),
    expected: { open: true },
  },
  {
    name: 'close resets open, editorTarget, and runId together',
    setup: { open: true, editorTarget: { mode: 'new' }, runId: 'r1' },
    act: (s) => s.close(),
    expected: { open: false, editorTarget: null, runId: null },
  },
  {
    name: 'openEditor sets the target and clears any open run',
    setup: { runId: 'r1' },
    act: (s) => s.openEditor({ mode: 'edit', automationId: 'a1' }),
    expected: { editorTarget: { mode: 'edit', automationId: 'a1' }, runId: null },
  },
  {
    name: 'closeEditor clears only the editor target',
    setup: { editorTarget: { mode: 'new' }, runId: 'r1' },
    act: (s) => s.closeEditor(),
    expected: { editorTarget: null, runId: 'r1' },
  },
  {
    name: 'openRun sets the run id and clears any open editor',
    setup: { editorTarget: { mode: 'new' } },
    act: (s) => s.openRun('r2'),
    expected: { runId: 'r2', editorTarget: null },
  },
  {
    name: 'closeRun clears only the run id',
    setup: { runId: 'r2', editorTarget: { mode: 'new' } },
    act: (s) => s.closeRun(),
    expected: { runId: null, editorTarget: { mode: 'new' } },
  },
];

describe('useAutomationsNav', () => {
  beforeEach(() => {
    useAutomationsNav.setState({ open: false, editorTarget: null, runId: null });
  });

  it.each(SETTER_CASES)('$name', ({ setup, act, expected }) => {
    useAutomationsNav.setState(setup);
    act(useAutomationsNav.getState());
    expect(useAutomationsNav.getState()).toMatchObject(expected);
  });

  it('openEditor accepts an optional draft on the new-mode target (Describe-it → Open in editor)', () => {
    const draft = { name: 'Daily health log', scope: 'global' as const, definition: { triggers: [], steps: [] } };
    useAutomationsNav.getState().openEditor({ mode: 'new', draft });
    expect(useAutomationsNav.getState().editorTarget).toEqual({ mode: 'new', draft });
  });

  describe('describe flow', () => {
    beforeEach(() => {
      useAutomationsNav.setState({ open: false, editorTarget: null, runId: null, describeOpen: false });
    });

    it('openDescribe opens describe and clears any open editor/run', () => {
      useAutomationsNav.setState({ editorTarget: { mode: 'new' }, runId: 'r1' });
      useAutomationsNav.getState().openDescribe();
      const s = useAutomationsNav.getState();
      expect(s.describeOpen).toBe(true);
      expect(s.editorTarget).toBeNull();
      expect(s.runId).toBeNull();
    });

    it('closeDescribe clears only describeOpen', () => {
      useAutomationsNav.setState({ describeOpen: true, runId: 'r1' });
      useAutomationsNav.getState().closeDescribe();
      const s = useAutomationsNav.getState();
      expect(s.describeOpen).toBe(false);
      expect(s.runId).toBe('r1');
    });

    it('openEditor and openRun both clear describeOpen', () => {
      useAutomationsNav.setState({ describeOpen: true });
      useAutomationsNav.getState().openEditor({ mode: 'new' });
      expect(useAutomationsNav.getState().describeOpen).toBe(false);

      useAutomationsNav.setState({ describeOpen: true });
      useAutomationsNav.getState().openRun('r1');
      expect(useAutomationsNav.getState().describeOpen).toBe(false);
    });

    it('close resets describeOpen too', () => {
      useAutomationsNav.setState({ open: true, describeOpen: true });
      useAutomationsNav.getState().close();
      expect(useAutomationsNav.getState().describeOpen).toBe(false);
    });
  });

  describe('details flow (todo #233)', () => {
    beforeEach(() => {
      useAutomationsNav.setState({ open: false, editorTarget: null, runId: null, detailsAutomationId: null });
    });

    it('openDetails sets the automation id and clears any open editor/run/describe', () => {
      useAutomationsNav.setState({ editorTarget: { mode: 'new' }, runId: 'r1', describeOpen: true });
      useAutomationsNav.getState().openDetails('auto-1');
      const s = useAutomationsNav.getState();
      expect(s.detailsAutomationId).toBe('auto-1');
      expect(s.editorTarget).toBeNull();
      expect(s.runId).toBeNull();
      expect(s.describeOpen).toBe(false);
    });

    it('closeDetails clears only the details target', () => {
      useAutomationsNav.setState({ detailsAutomationId: 'auto-1', runId: 'r1' });
      useAutomationsNav.getState().closeDetails();
      const s = useAutomationsNav.getState();
      expect(s.detailsAutomationId).toBeNull();
      expect(s.runId).toBe('r1');
    });

    it('openEditor, openRun, and openDescribe all clear an open details target', () => {
      useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
      useAutomationsNav.getState().openEditor({ mode: 'new' });
      expect(useAutomationsNav.getState().detailsAutomationId).toBeNull();

      useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
      useAutomationsNav.getState().openRun('r1');
      expect(useAutomationsNav.getState().detailsAutomationId).toBeNull();

      useAutomationsNav.setState({ detailsAutomationId: 'auto-1' });
      useAutomationsNav.getState().openDescribe();
      expect(useAutomationsNav.getState().detailsAutomationId).toBeNull();
    });

    it('close resets detailsAutomationId too', () => {
      useAutomationsNav.setState({ open: true, detailsAutomationId: 'auto-1' });
      useAutomationsNav.getState().close();
      expect(useAutomationsNav.getState().detailsAutomationId).toBeNull();
    });
  });
});
