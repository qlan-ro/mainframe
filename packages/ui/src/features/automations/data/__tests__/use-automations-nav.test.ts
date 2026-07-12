import { beforeEach, describe, expect, it } from 'vitest';
import { useAutomationsNav } from '../use-automations-nav';

describe('useAutomationsNav', () => {
  beforeEach(() => {
    useAutomationsNav.setState({ open: false, editorTarget: null, runId: null });
  });

  it('openHost opens the host', () => {
    useAutomationsNav.getState().openHost();
    expect(useAutomationsNav.getState().open).toBe(true);
  });

  it('close resets open, editorTarget, and runId together', () => {
    useAutomationsNav.setState({ open: true, editorTarget: { mode: 'new' }, runId: 'r1' });
    useAutomationsNav.getState().close();
    const s = useAutomationsNav.getState();
    expect(s.open).toBe(false);
    expect(s.editorTarget).toBeNull();
    expect(s.runId).toBeNull();
  });

  it('openEditor sets the target and clears any open run', () => {
    useAutomationsNav.setState({ runId: 'r1' });
    useAutomationsNav.getState().openEditor({ mode: 'edit', automationId: 'a1' });
    const s = useAutomationsNav.getState();
    expect(s.editorTarget).toEqual({ mode: 'edit', automationId: 'a1' });
    expect(s.runId).toBeNull();
  });

  it('closeEditor clears only the editor target', () => {
    useAutomationsNav.setState({ editorTarget: { mode: 'new' }, runId: 'r1' });
    useAutomationsNav.getState().closeEditor();
    const s = useAutomationsNav.getState();
    expect(s.editorTarget).toBeNull();
    expect(s.runId).toBe('r1');
  });

  it('openRun sets the run id and clears any open editor', () => {
    useAutomationsNav.setState({ editorTarget: { mode: 'new' } });
    useAutomationsNav.getState().openRun('r2');
    const s = useAutomationsNav.getState();
    expect(s.runId).toBe('r2');
    expect(s.editorTarget).toBeNull();
  });

  it('closeRun clears only the run id', () => {
    useAutomationsNav.setState({ runId: 'r2', editorTarget: { mode: 'new' } });
    useAutomationsNav.getState().closeRun();
    const s = useAutomationsNav.getState();
    expect(s.runId).toBeNull();
    expect(s.editorTarget).toEqual({ mode: 'new' });
  });
});
