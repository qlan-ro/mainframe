// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { subscribeToFileIntents } from '../intent-subscriber';
import { emitSurfaceIntent } from '../surface-intents';
import { useSettingsStore } from '../settings';
import { useUiPrefs } from '../ui-prefs';
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

  it('toggle-workspace-files collapses an expanded Files tree', () => {
    useUiPrefs.setState({ workspaceFilesCollapsed: false });

    emitSurfaceIntent({ type: 'toggle-workspace-files' });

    expect(useUiPrefs.getState().workspaceFilesCollapsed).toBe(true);
  });

  it('collapsing does NOT touch the layout store', () => {
    // Only EXPANDING needs the surface; collapsing must not drag a hidden
    // workspace into view (nor rewrite the layout at all).
    useUiPrefs.setState({ workspaceFilesCollapsed: false });
    const layoutBefore = useLayoutStore.getState().layout;

    emitSurfaceIntent({ type: 'toggle-workspace-files' });

    expect(useLayoutStore.getState().layout).toBe(layoutBefore);
    expect(isWorkspaceActive()).toBe(false);
  });

  it('toggle-workspace-files expands the tree AND lights the workspace surface', () => {
    // An expanded tree inside a hidden surface would show nothing.
    useUiPrefs.setState({ workspaceFilesCollapsed: true });
    expect(isWorkspaceActive()).toBe(false);

    emitSurfaceIntent({ type: 'toggle-workspace-files' });

    expect(useUiPrefs.getState().workspaceFilesCollapsed).toBe(false);
    expect(isWorkspaceActive()).toBe(true);
  });
});
