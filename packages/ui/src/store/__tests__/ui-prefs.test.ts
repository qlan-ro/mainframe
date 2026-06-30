import { beforeEach, describe, expect, it } from 'vitest';
import { SIDEBAR_EXPANDED_WIDTH } from '@/layout/SidebarShell';
import {
  useUiPrefs,
  clampBottomPanelHeight,
  BOTTOM_PANEL_MIN_HEIGHT,
  BOTTOM_PANEL_DEFAULT_HEIGHT,
  BOTTOM_PANEL_MAX_FALLBACK,
} from '../ui-prefs';

const STORAGE_KEY = 'mf:ui-prefs';

beforeEach(() => {
  localStorage.clear();
  // Reset store to declared defaults between tests.
  useUiPrefs.setState({
    sidebarVisible: true,
    inspectorVisible: false,
    sidebarWidth: SIDEBAR_EXPANDED_WIDTH,
    bottomPanelTab: 'context',
    bottomPanelHeight: BOTTOM_PANEL_DEFAULT_HEIGHT,
    rightClickHintDismissed: false,
  });
});

describe('useUiPrefs defaults', () => {
  it('has the documented defaults', () => {
    const s = useUiPrefs.getState();
    expect(s.sidebarVisible).toBe(true);
    expect(s.inspectorVisible).toBe(false);
    expect(s.sidebarWidth).toBe(SIDEBAR_EXPANDED_WIDTH);
    expect(s.bottomPanelTab).toBe('context');
    expect(s.bottomPanelHeight).toBe(BOTTOM_PANEL_DEFAULT_HEIGHT);
    expect(s.rightClickHintDismissed).toBe(false);
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
    // clampSidebarWidth caps at SIDEBAR_MAX_WIDTH (640).
    expect(useUiPrefs.getState().sidebarWidth).toBe(640);
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
