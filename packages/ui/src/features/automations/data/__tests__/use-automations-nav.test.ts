import { beforeEach, describe, expect, it } from 'vitest';
import { useAutomationsNav } from '../use-automations-nav';
import { useUiPrefs } from '@/store/ui-prefs';

type AutomationsNavState = ReturnType<typeof useAutomationsNav.getState>;

type SetterCase = {
  name: string;
  setup: Partial<AutomationsNavState>;
  act: (s: AutomationsNavState) => void;
  expected: Partial<AutomationsNavState>;
};

const SETTER_CASES: SetterCase[] = [
  {
    name: 'closeEditor clears only the editor target',
    setup: { editorTarget: { mode: 'new' }, detailsAutomationId: 'a1' },
    act: (s) => s.closeEditor(),
    expected: { editorTarget: null, detailsAutomationId: 'a1' },
  },
  {
    name: 'closeDescribe clears only describeOpen',
    setup: { describeOpen: true, detailsAutomationId: 'a1' },
    act: (s) => s.closeDescribe(),
    expected: { describeOpen: false, detailsAutomationId: 'a1' },
  },
];

beforeEach(() => {
  useAutomationsNav.setState({
    editorTarget: null,
    describeOpen: false,
    detailsAutomationId: null,
    selectedRunId: null,
  });
  useUiPrefs.setState({ sidebarView: 'chats' });
});

describe('useAutomationsNav', () => {
  it.each(SETTER_CASES)('$name', ({ setup, act, expected }) => {
    useAutomationsNav.setState(setup);
    act(useAutomationsNav.getState());
    expect(useAutomationsNav.getState()).toMatchObject(expected);
  });

  it('openHost shows the Automations rail view without touching any open sub-view', () => {
    useAutomationsNav.setState({ detailsAutomationId: 'a1' });
    useAutomationsNav.getState().openHost();
    expect(useUiPrefs.getState().sidebarView).toBe('automations');
    expect(useAutomationsNav.getState().detailsAutomationId).toBe('a1');
  });

  describe('openEditor / closeEditor — remembers where it came from (2026-10 redesign)', () => {
    it('opening the editor on top of an open details view leaves detailsAutomationId set, so closing falls back to it', () => {
      useAutomationsNav.setState({ detailsAutomationId: 'a1', selectedRunId: 'r1' });
      useAutomationsNav.getState().openEditor({ mode: 'edit', automationId: 'a1' });
      expect(useAutomationsNav.getState().detailsAutomationId).toBe('a1');

      useAutomationsNav.getState().closeEditor();
      const s = useAutomationsNav.getState();
      expect(s.editorTarget).toBeNull();
      expect(s.detailsAutomationId).toBe('a1');
    });

    it('a brand-new editor target clears any open describe flow', () => {
      useAutomationsNav.setState({ describeOpen: true });
      useAutomationsNav.getState().openEditor({ mode: 'new' });
      expect(useAutomationsNav.getState().describeOpen).toBe(false);
    });

    it('accepts an optional draft on the new-mode target (Describe-it → Open in editor)', () => {
      const draft = { name: 'Daily health log', scope: 'global' as const, definition: { triggers: [], steps: [] } };
      useAutomationsNav.getState().openEditor({ mode: 'new', draft });
      expect(useAutomationsNav.getState().editorTarget).toEqual({ mode: 'new', draft });
    });
  });

  describe('openDescribe / closeDescribe', () => {
    it('opening describe clears any open editor, leaving detailsAutomationId as-is', () => {
      useAutomationsNav.setState({ editorTarget: { mode: 'new' }, detailsAutomationId: 'a1' });
      useAutomationsNav.getState().openDescribe();
      const s = useAutomationsNav.getState();
      expect(s.describeOpen).toBe(true);
      expect(s.editorTarget).toBeNull();
      expect(s.detailsAutomationId).toBe('a1');
    });
  });

  describe('openDetails / closeDetails / selectRun', () => {
    it('openDetails sets the automation id, defaults to Overview, and clears any open editor/describe', () => {
      useAutomationsNav.setState({ editorTarget: { mode: 'new' }, describeOpen: true, selectedRunId: 'stale' });
      useAutomationsNav.getState().openDetails('auto-1');
      const s = useAutomationsNav.getState();
      expect(s.detailsAutomationId).toBe('auto-1');
      expect(s.editorTarget).toBeNull();
      expect(s.describeOpen).toBe(false);
      expect(s.selectedRunId).toBeNull();
    });

    it('openDetails accepts a runId that pins the column selection (a toast\'s "View run")', () => {
      useAutomationsNav.getState().openDetails('auto-1', 'run-9');
      const s = useAutomationsNav.getState();
      expect(s.detailsAutomationId).toBe('auto-1');
      expect(s.selectedRunId).toBe('run-9');
    });

    it('selectRun changes the column selection without touching detailsAutomationId', () => {
      useAutomationsNav.setState({ detailsAutomationId: 'auto-1', selectedRunId: null });
      useAutomationsNav.getState().selectRun('run-1');
      expect(useAutomationsNav.getState()).toMatchObject({ detailsAutomationId: 'auto-1', selectedRunId: 'run-1' });

      useAutomationsNav.getState().selectRun(null);
      expect(useAutomationsNav.getState()).toMatchObject({ detailsAutomationId: 'auto-1', selectedRunId: null });
    });

    it('closeDetails clears the automation id and the run selection together', () => {
      useAutomationsNav.setState({ detailsAutomationId: 'auto-1', selectedRunId: 'run-1' });
      useAutomationsNav.getState().closeDetails();
      const s = useAutomationsNav.getState();
      expect(s.detailsAutomationId).toBeNull();
      expect(s.selectedRunId).toBeNull();
    });

    it('openEditor leaves both detailsAutomationId and the run selection alone, so Cancel lands back on the same run', () => {
      useAutomationsNav.setState({ detailsAutomationId: 'auto-1', selectedRunId: 'run-1' });
      useAutomationsNav.getState().openEditor({ mode: 'edit', automationId: 'auto-1' });
      expect(useAutomationsNav.getState()).toMatchObject({ detailsAutomationId: 'auto-1', selectedRunId: 'run-1' });
    });
  });
});
