// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
const SIDEBAR_DEFAULT_WIDTH = 256; // mirrors ui-prefs (v2 sidebar 16rem default)
import { useUiPrefs, isSidebarSectionCollapsed, isSessionPanelSectionOpen } from '../ui-prefs';

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
    rightClickHintDismissed: false,
    dontWarnOnTuningChange: false,
    collapsedSidebarSections: {},
    sessionPanelSections: {},
  });
});

describe('useUiPrefs defaults', () => {
  it('has the documented defaults', () => {
    const s = useUiPrefs.getState();
    expect(s.sidebarVisible).toBe(true);
    expect(s.inspectorVisible).toBe(false);
    expect(s.sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(s.rightClickHintDismissed).toBe(false);
    expect(s.dontWarnOnTuningChange).toBe(false);
    expect(s.collapsedSidebarSections).toEqual({});
    expect(s.sessionPanelSections).toEqual({});
  });
});

describe('isSessionPanelSectionOpen', () => {
  it('applies the per-section defaults when nothing is recorded', () => {
    expect(isSessionPanelSectionOpen({}, 'plan')).toBe(false);
    expect(isSessionPanelSectionOpen({}, 'activity')).toBe(false);
    expect(isSessionPanelSectionOpen({}, 'launch')).toBe(false);
    expect(isSessionPanelSectionOpen({}, 'context')).toBe(true);
  });

  it('returns the recorded value when present', () => {
    expect(isSessionPanelSectionOpen({ plan: true }, 'plan')).toBe(true);
    expect(isSessionPanelSectionOpen({ context: false }, 'context')).toBe(false);
  });
});

describe('session-panel section actions', () => {
  it('toggleSessionPanelSection opens a collapsed section and closes it again', () => {
    useUiPrefs.getState().toggleSessionPanelSection('plan');
    expect(useUiPrefs.getState().sessionPanelSections.plan).toBe(true);
    useUiPrefs.getState().toggleSessionPanelSection('plan');
    expect(useUiPrefs.getState().sessionPanelSections.plan).toBe(false);
  });

  it('toggleSessionPanelSection closes Context first — it defaults to open', () => {
    useUiPrefs.getState().toggleSessionPanelSection('context');
    expect(useUiPrefs.getState().sessionPanelSections.context).toBe(false);
  });

  it('expandSessionPanelSection is idempotent — twice on an open section leaves it open', () => {
    useUiPrefs.getState().expandSessionPanelSection('launch');
    expect(useUiPrefs.getState().sessionPanelSections.launch).toBe(true);
    useUiPrefs.getState().expandSessionPanelSection('launch');
    expect(useUiPrefs.getState().sessionPanelSections.launch).toBe(true);
  });

  it('expandSessionPanelSection re-opens a section the user collapsed', () => {
    useUiPrefs.getState().toggleSessionPanelSection('context');
    expect(useUiPrefs.getState().sessionPanelSections.context).toBe(false);
    useUiPrefs.getState().expandSessionPanelSection('context');
    expect(useUiPrefs.getState().sessionPanelSections.context).toBe(true);
  });

  it('persists the map to localStorage', () => {
    useUiPrefs.getState().expandSessionPanelSection('plan');
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.state.sessionPanelSections).toEqual({ plan: true });
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

describe('useUiPrefs persistence', () => {
  it('writes only the whitelisted fields to localStorage', () => {
    useUiPrefs.getState().setSidebarWidth(300);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    // zustand persist wraps as { state, version }.
    expect(parsed.state.sidebarWidth).toBe(300);
    expect(Object.keys(parsed.state).sort()).toEqual(
      [
        'collapsedSidebarSections',
        'dontWarnOnTuningChange',
        'inspectorVisible',
        'rightClickHintDismissed',
        'sessionPanelSections',
        'sidebarVisible',
        'sidebarWidth',
      ].sort(),
    );
    // Actions are never serialized.
    expect(parsed.state.toggleSidebar).toBeUndefined();
  });
});

describe('useUiPrefs v1 → v2 migration', () => {
  it('strips the bottom-panel keys from a v1 payload', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { sidebarWidth: 300, bottomPanelTab: 'skills', bottomPanelHeight: 420 },
        version: 1,
      }),
    );
    const fresh = await reloadStore();
    // Proves hydration actually ran, so the next assertions aren't vacuous.
    expect(fresh.getState().sidebarWidth).toBe(300);
    // Stripped by migrate, so they never reach the store...
    const state = fresh.getState() as unknown as Record<string, unknown>;
    expect(state.bottomPanelTab).toBeUndefined();
    expect(state.bottomPanelHeight).toBeUndefined();
    // ...nor get written back out on the next persist.
    fresh.getState().setSidebarWidth(320);
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.state.bottomPanelTab).toBeUndefined();
    expect(parsed.state.bottomPanelHeight).toBeUndefined();
  });

  it('leaves a v1 payload without bottom-panel keys otherwise intact', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { sidebarVisible: false, sessionPanelSections: { launch: true } },
        version: 1,
      }),
    );
    const fresh = await reloadStore();
    expect(fresh.getState().sidebarVisible).toBe(false);
    expect(fresh.getState().sessionPanelSections).toEqual({ launch: true });
  });
});

describe('useUiPrefs rehydration: dontWarnOnTuningChange', () => {
  it('fills the default when a legacy payload predates the key', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { sidebarWidth: 300 }, version: 1 }));
    const fresh = await reloadStore();
    // Proves hydration actually ran, so the next assertion isn't vacuous.
    expect(fresh.getState().sidebarWidth).toBe(300);
    expect(fresh.getState().dontWarnOnTuningChange).toBe(false);
  });

  it('a persisted true survives a reload', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { sidebarWidth: 300, dontWarnOnTuningChange: true },
        version: 1,
      }),
    );
    const fresh = await reloadStore();
    expect(fresh.getState().dontWarnOnTuningChange).toBe(true);
  });
});
