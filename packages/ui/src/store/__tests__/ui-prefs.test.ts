// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiPrefs, isSessionPanelSectionOpen, dialogSizeFor, SIDEBAR_DEFAULT_WIDTH } from '../ui-prefs';

const STORAGE_KEY = 'mf:ui-prefs';

// The persisted-payload migrations live in ui-prefs-migration.test.ts and
// ui-prefs-migration-v8.test.ts.

beforeEach(() => {
  localStorage.clear();
  // Reset store to declared defaults between tests.
  useUiPrefs.setState({
    sidebarVisible: true,
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    sidebarView: 'chats',
    dontWarnOnTuningChange: false,
    sessionPanelOpen: true,
    sessionPanelSections: {},
    dialogSizes: {},
  });
});

describe('useUiPrefs defaults', () => {
  it('has the documented defaults', () => {
    const s = useUiPrefs.getState();
    expect(s.sidebarVisible).toBe(true);
    expect(s.sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(s.sidebarWidth).toBe(260);
    expect(s.sidebarView).toBe('chats');
    expect(s.dontWarnOnTuningChange).toBe(false);
    expect(s.sessionPanelOpen).toBe(true);
    expect(s.sessionPanelSections).toEqual({});
    expect(s.dialogSizes).toEqual({});
  });
});

describe('dialogSizeFor', () => {
  const fallback = { width: 760, height: 600 };

  it('falls back to the declared default when the key is absent', () => {
    expect(dialogSizeFor({}, 'settings', fallback)).toBe(fallback);
  });

  it('returns the stored size when the key is present', () => {
    const stored = { width: 900, height: 700 };
    expect(dialogSizeFor({ settings: stored }, 'settings', fallback)).toBe(stored);
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

describe('D8: the session panel open bit is ONE boolean for the whole panel', () => {
  it('defaults open', () => {
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(true);
  });

  it('toggleSessionPanel flips the single bit', () => {
    useUiPrefs.getState().toggleSessionPanel();
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(false);
    useUiPrefs.getState().toggleSessionPanel();
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(true);
  });

  it('setSessionPanelOpen sets the bit directly, idempotently', () => {
    useUiPrefs.getState().setSessionPanelOpen(false);
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(false);
    useUiPrefs.getState().setSessionPanelOpen(false);
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(false);
    useUiPrefs.getState().setSessionPanelOpen(true);
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(true);
  });

  it('persists the bit to localStorage', () => {
    useUiPrefs.getState().setSessionPanelOpen(false);
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.state.sessionPanelOpen).toBe(false);
  });
});

describe('D4: sidebarView — which list the nav rail selects', () => {
  it('defaults to "chats"', () => {
    expect(useUiPrefs.getState().sidebarView).toBe('chats');
  });

  it('setSidebarView switches the sidebar and persists it', () => {
    useUiPrefs.getState().setSidebarView('tasks');
    expect(useUiPrefs.getState().sidebarView).toBe('tasks');
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.state.sidebarView).toBe('tasks');
  });

  it('setSidebarView can select automations too', () => {
    useUiPrefs.getState().setSidebarView('automations');
    expect(useUiPrefs.getState().sidebarView).toBe('automations');
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

  it('persists the map to localStorage', () => {
    useUiPrefs.getState().toggleSessionPanelSection('plan');
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

  it('setDialogSize writes under the dialog key and leaves siblings alone', () => {
    useUiPrefs.getState().setDialogSize('settings', { width: 900, height: 700 });
    expect(useUiPrefs.getState().dialogSizes).toEqual({ settings: { width: 900, height: 700 } });
    useUiPrefs.getState().setDialogSize('review', { width: 1200, height: 880 });
    expect(useUiPrefs.getState().dialogSizes).toEqual({
      settings: { width: 900, height: 700 },
      review: { width: 1200, height: 880 },
    });
  });

  it('setDialogSize persists the size to localStorage, not just in-memory state', () => {
    useUiPrefs.getState().setDialogSize('settings', { width: 900, height: 700 });
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.state.dialogSizes).toEqual({ settings: { width: 900, height: 700 } });
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
        'dialogSizes',
        'dontWarnOnTuningChange',
        'sessionPanelOpen',
        'sessionPanelSections',
        'sideChatFrac',
        'sidebarVisible',
        'sidebarWidth',
        'sidebarView',
        'transcriptMode',
      ].sort(),
    );
    // Actions are never serialized.
    expect(parsed.state.toggleSidebar).toBeUndefined();
  });
});

describe('useUiPrefs — side chat share', () => {
  it('clamps the persisted side-chat share to 15–85% of the row', () => {
    useUiPrefs.getState().setSideChatFrac(0.02);
    expect(useUiPrefs.getState().sideChatFrac).toBe(0.15);
    useUiPrefs.getState().setSideChatFrac(0.99);
    expect(useUiPrefs.getState().sideChatFrac).toBe(0.85);
    useUiPrefs.getState().setSideChatFrac(0.5);
    expect(useUiPrefs.getState().sideChatFrac).toBe(0.5);
  });
});
