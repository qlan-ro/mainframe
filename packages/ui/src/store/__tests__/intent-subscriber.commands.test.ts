// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { subscribeToFileIntents } from '../intent-subscriber';
import { emitSurfaceIntent } from '../surface-intents';
import { useSettingsStore } from '../settings';
import { useUiPrefs } from '../ui-prefs';
import { useWorkspaceFilesPanel } from '../workspace-files-panel';
import { useLayoutStore } from '../layout';

function isWorkspaceActive() {
  const { layout } = useLayoutStore.getState();
  return layout.top.includes('workspace') || layout.bottom === 'workspace';
}

describe('intent-subscriber — command intents', () => {
  let unsub: () => void;
  beforeEach(() => {
    useLayoutStore.setState({
      layout: { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
      run: null,
      sessions: new Map(),
      activeSessionId: null,
    });
    unsub = subscribeToFileIntents();
  });
  afterEach(() => unsub());

  it('open-settings opens the settings store', () => {
    useSettingsStore.setState({ isOpen: false });
    emitSurfaceIntent({ type: 'open-settings' });
    expect(useSettingsStore.getState().isOpen).toBe(true);
  });

  it('toggle-sidebar flips sidebarVisible', () => {
    const before = useUiPrefs.getState().sidebarVisible;
    emitSurfaceIntent({ type: 'toggle-sidebar' });
    expect(useUiPrefs.getState().sidebarVisible).toBe(!before);
  });

  it('toggle-workspace-files closes a panel that is ON SCREEN, touching nothing else', () => {
    useLayoutStore.setState({
      layout: { top: ['chat', 'workspace'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    });
    useWorkspaceFilesPanel.setState({ open: true });
    const layoutBefore = useLayoutStore.getState().layout;

    emitSurfaceIntent({ type: 'toggle-workspace-files' });

    expect(useWorkspaceFilesPanel.getState().open).toBe(false);
    // Closing must not rewrite the layout (nor hide the workspace).
    expect(useLayoutStore.getState().layout).toBe(layoutBefore);
  });

  it('an open-but-invisible panel is SHOWN, never closed', () => {
    // The panel flag is on, but the workspace surface is unlit — the tree is
    // not on screen. The toggle means "show me the files": light the surface
    // and keep the panel open, instead of closing a tree nobody can see.
    useWorkspaceFilesPanel.setState({ open: true });
    expect(isWorkspaceActive()).toBe(false);

    emitSurfaceIntent({ type: 'toggle-workspace-files' });

    expect(useWorkspaceFilesPanel.getState().open).toBe(true);
    expect(isWorkspaceActive()).toBe(true);
  });

  it('toggle-workspace-files opens the panel AND lights the workspace surface', () => {
    // An open panel inside a hidden surface would show nothing.
    useWorkspaceFilesPanel.setState({ open: false });
    expect(isWorkspaceActive()).toBe(false);

    emitSurfaceIntent({ type: 'toggle-workspace-files' });

    expect(useWorkspaceFilesPanel.getState().open).toBe(true);
    expect(isWorkspaceActive()).toBe(true);
  });
});
