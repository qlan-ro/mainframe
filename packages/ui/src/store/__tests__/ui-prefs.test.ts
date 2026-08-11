// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
const SIDEBAR_DEFAULT_WIDTH = 256; // mirrors ui-prefs (v2 sidebar 16rem default)
import { useUiPrefs, isSidebarSectionCollapsed, isSessionPanelOpen, isSessionPanelSectionOpen } from '../ui-prefs';

const STORAGE_KEY = 'mf:ui-prefs';

// The persisted-payload migrations live in ui-prefs-migration.test.ts.

beforeEach(() => {
  localStorage.clear();
  // Reset store to declared defaults between tests.
  useUiPrefs.setState({
    sidebarVisible: true,
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    rightClickHintDismissed: false,
    dontWarnOnTuningChange: false,
    collapsedSidebarSections: {},
    sessionPanelOpen: {},
    sessionPanelSections: {},
  });
});

describe('useUiPrefs defaults', () => {
  it('has the documented defaults', () => {
    const s = useUiPrefs.getState();
    expect(s.sidebarVisible).toBe(true);
    expect(s.sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(s.rightClickHintDismissed).toBe(false);
    expect(s.dontWarnOnTuningChange).toBe(false);
    expect(s.collapsedSidebarSections).toEqual({});
    expect(s.sessionPanelOpen).toEqual({});
    expect(s.sessionPanelSections).toEqual({});
  });
});

describe('isSessionPanelOpen', () => {
  it('opens the session card alone on first run', () => {
    expect(isSessionPanelOpen({}, 'session')).toBe(true);
    expect(isSessionPanelOpen({}, 'activity')).toBe(false);
    expect(isSessionPanelOpen({}, 'launch')).toBe(false);
    expect(isSessionPanelOpen({}, 'tasks')).toBe(false);
  });

  it('returns the recorded value when present', () => {
    expect(isSessionPanelOpen({ session: false }, 'session')).toBe(false);
    expect(isSessionPanelOpen({ tasks: true }, 'tasks')).toBe(true);
  });
});

describe('isSessionPanelSectionOpen', () => {
  it('applies the per-section defaults when nothing is recorded', () => {
    expect(isSessionPanelSectionOpen({}, 'plan')).toBe(false);
    expect(isSessionPanelSectionOpen({}, 'context')).toBe(true);
  });

  it('returns the recorded value when present', () => {
    expect(isSessionPanelSectionOpen({ plan: true }, 'plan')).toBe(true);
    expect(isSessionPanelSectionOpen({ context: false }, 'context')).toBe(false);
  });
});

describe('stacked panel actions', () => {
  it('toggleSessionPanel closes the session card first — it defaults to open', () => {
    useUiPrefs.getState().toggleSessionPanel('session');
    expect(useUiPrefs.getState().sessionPanelOpen.session).toBe(false);
    useUiPrefs.getState().toggleSessionPanel('session');
    expect(useUiPrefs.getState().sessionPanelOpen.session).toBe(true);
  });

  it('toggleSessionPanel opens a closed panel and closes it again', () => {
    useUiPrefs.getState().toggleSessionPanel('tasks');
    expect(useUiPrefs.getState().sessionPanelOpen.tasks).toBe(true);
    useUiPrefs.getState().toggleSessionPanel('tasks');
    expect(useUiPrefs.getState().sessionPanelOpen.tasks).toBe(false);
  });

  it('toggleSessionPanel leaves its siblings alone — the panels are independent', () => {
    useUiPrefs.getState().toggleSessionPanel('activity');
    expect(useUiPrefs.getState().sessionPanelOpen).toEqual({ activity: true });
  });

  it('openSessionPanel is idempotent — twice on an open panel leaves it open', () => {
    useUiPrefs.getState().openSessionPanel('launch');
    expect(useUiPrefs.getState().sessionPanelOpen.launch).toBe(true);
    useUiPrefs.getState().openSessionPanel('launch');
    expect(useUiPrefs.getState().sessionPanelOpen.launch).toBe(true);
  });

  it('openSessionPanel re-opens a panel the user closed', () => {
    useUiPrefs.getState().toggleSessionPanel('session');
    expect(useUiPrefs.getState().sessionPanelOpen.session).toBe(false);
    useUiPrefs.getState().openSessionPanel('session');
    expect(useUiPrefs.getState().sessionPanelOpen.session).toBe(true);
  });

  it('persists the open map to localStorage', () => {
    useUiPrefs.getState().openSessionPanel('tasks');
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.state.sessionPanelOpen).toEqual({ tasks: true });
  });
});

describe('session-card section actions', () => {
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
    useUiPrefs.getState().expandSessionPanelSection('plan');
    expect(useUiPrefs.getState().sessionPanelSections.plan).toBe(true);
    useUiPrefs.getState().expandSessionPanelSection('plan');
    expect(useUiPrefs.getState().sessionPanelSections.plan).toBe(true);
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
        'rightClickHintDismissed',
        'sessionPanelOpen',
        'sessionPanelSections',
        'sidebarVisible',
        'sidebarWidth',
      ].sort(),
    );
    // Actions are never serialized.
    expect(parsed.state.toggleSidebar).toBeUndefined();
  });
});
