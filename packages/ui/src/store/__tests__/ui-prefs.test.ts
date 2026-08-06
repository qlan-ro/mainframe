// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
const SIDEBAR_DEFAULT_WIDTH = 256; // mirrors ui-prefs (v2 sidebar 16rem default)
import {
  useUiPrefs,
  clampBottomPanelHeight,
  isSidebarSectionCollapsed,
  BOTTOM_PANEL_MIN_HEIGHT,
  BOTTOM_PANEL_DEFAULT_HEIGHT,
  BOTTOM_PANEL_MAX_FALLBACK,
} from '../ui-prefs';

const STORAGE_KEY = 'mf:ui-prefs';

/** Fresh module + fresh initial state, hydrated from whatever is in localStorage right now. */
async function reloadStore() {
  vi.resetModules();
  const mod = await import('../ui-prefs');
  await mod.useUiPrefs.persist.rehydrate();
  return mod.useUiPrefs;
}

beforeEach(() => {
  localStorage.clear();
  // Reset store to declared defaults between tests.
  useUiPrefs.setState({
    sidebarVisible: true,
    inspectorVisible: false,
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    bottomPanelTab: 'context',
    bottomPanelHeight: BOTTOM_PANEL_DEFAULT_HEIGHT,
    rightClickHintDismissed: false,
    dontWarnOnTuningChange: false,
    collapsedSidebarSections: {},
  });
});

describe('useUiPrefs defaults', () => {
  it('has the documented defaults', () => {
    const s = useUiPrefs.getState();
    expect(s.sidebarVisible).toBe(true);
    expect(s.inspectorVisible).toBe(false);
    expect(s.sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(s.bottomPanelTab).toBe('context');
    expect(s.bottomPanelHeight).toBe(BOTTOM_PANEL_DEFAULT_HEIGHT);
    expect(s.rightClickHintDismissed).toBe(false);
    expect(s.dontWarnOnTuningChange).toBe(false);
    expect(s.collapsedSidebarSections).toEqual({});
  });
});

describe('useUiPrefs actions', () => {
  it('toggleSidebar flips sidebarVisible', () => {
    useUiPrefs.getState().toggleSidebar();
    expect(useUiPrefs.getState().sidebarVisible).toBe(false);
    useUiPrefs.getState().toggleSidebar();
    expect(useUiPrefs.getState().sidebarVisible).toBe(true);
  });

  it('toggleInspector flips inspectorVisible', () => {
    useUiPrefs.getState().toggleInspector();
    expect(useUiPrefs.getState().inspectorVisible).toBe(true);
  });

  it('setSidebarWidth stores a clamped width', () => {
    useUiPrefs.getState().setSidebarWidth(99999);
    // clampSidebarWidth caps at the v2 sidebar's SIDEBAR_MAX_WIDTH (480).
    expect(useUiPrefs.getState().sidebarWidth).toBe(480);
  });

  it('setBottomPanelTab stores the tab', () => {
    useUiPrefs.getState().setBottomPanelTab('skills');
    expect(useUiPrefs.getState().bottomPanelTab).toBe('skills');
  });

  it('setBottomPanelHeight clamps against the fallback ceiling', () => {
    useUiPrefs.getState().setBottomPanelHeight(5);
    expect(useUiPrefs.getState().bottomPanelHeight).toBe(BOTTOM_PANEL_MIN_HEIGHT);
    useUiPrefs.getState().setBottomPanelHeight(99999);
    expect(useUiPrefs.getState().bottomPanelHeight).toBe(BOTTOM_PANEL_MAX_FALLBACK);
  });

  it('dismissRightClickHint permanently suppresses the hint', () => {
    expect(useUiPrefs.getState().rightClickHintDismissed).toBe(false);
    useUiPrefs.getState().dismissRightClickHint();
    expect(useUiPrefs.getState().rightClickHintDismissed).toBe(true);
  });

  it('dismissTuningChangeWarning permanently suppresses the mid-session tuning warning', () => {
    expect(useUiPrefs.getState().dontWarnOnTuningChange).toBe(false);
    useUiPrefs.getState().dismissTuningChangeWarning();
    expect(useUiPrefs.getState().dontWarnOnTuningChange).toBe(true);
  });

  it('dismissTuningChangeWarning persists the flag, not just in-memory state', () => {
    useUiPrefs.getState().dismissTuningChangeWarning();
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.state.dontWarnOnTuningChange).toBe(true);
  });

  it('toggleSidebarSection flips a section from expanded to collapsed and back', () => {
    useUiPrefs.getState().toggleSidebarSection('projects');
    expect(useUiPrefs.getState().collapsedSidebarSections.projects).toBe(true);
    useUiPrefs.getState().toggleSidebarSection('projects');
    expect(useUiPrefs.getState().collapsedSidebarSections.projects).toBe(false);
  });
});

describe('isSidebarSectionCollapsed', () => {
  it('treats a section with no recorded state as expanded (false)', () => {
    expect(isSidebarSectionCollapsed({}, 'projects')).toBe(false);
  });

  it('returns the recorded value when present', () => {
    expect(isSidebarSectionCollapsed({ projects: true }, 'projects')).toBe(true);
    expect(isSidebarSectionCollapsed({ projects: false }, 'projects')).toBe(false);
  });
});

describe('clampBottomPanelHeight', () => {
  it('clamps to [min, maxHeight]', () => {
    expect(clampBottomPanelHeight(5, 400)).toBe(BOTTOM_PANEL_MIN_HEIGHT);
    expect(clampBottomPanelHeight(800, 400)).toBe(400);
    expect(clampBottomPanelHeight(250, 400)).toBe(250);
  });
});

describe('useUiPrefs persistence', () => {
  it('writes only the whitelisted fields to localStorage', () => {
    useUiPrefs.getState().setBottomPanelTab('agents');
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    // zustand persist wraps as { state, version }.
    expect(parsed.state.bottomPanelTab).toBe('agents');
    expect(Object.keys(parsed.state).sort()).toEqual(
      [
        'bottomPanelHeight',
        'bottomPanelTab',
        'collapsedSidebarSections',
        'dontWarnOnTuningChange',
        'inspectorVisible',
        'rightClickHintDismissed',
        'sidebarVisible',
        'sidebarWidth',
      ].sort(),
    );
    // Actions are never serialized.
    expect(parsed.state.toggleSidebar).toBeUndefined();
  });
});

describe('useUiPrefs rehydration: dontWarnOnTuningChange', () => {
  it('fills the default when a legacy payload predates the key', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { bottomPanelTab: 'skills' }, version: 1 }));
    const fresh = await reloadStore();
    // Proves hydration actually ran, so the next assertion isn't vacuous.
    expect(fresh.getState().bottomPanelTab).toBe('skills');
    expect(fresh.getState().dontWarnOnTuningChange).toBe(false);
  });

  it('a persisted true survives a reload', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { bottomPanelTab: 'skills', dontWarnOnTuningChange: true },
        version: 1,
      }),
    );
    const fresh = await reloadStore();
    expect(fresh.getState().dontWarnOnTuningChange).toBe(true);
  });
});
