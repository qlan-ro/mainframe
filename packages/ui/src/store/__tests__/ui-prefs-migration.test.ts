// @vitest-environment jsdom
/**
 * ui-prefs — persisted-payload migrations, split out of ui-prefs.test.ts to
 * keep both files under the 300-line cap. Every case seeds localStorage with an
 * old-version payload and rehydrates a fresh module.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});

describe('useUiPrefs v4 → v5 migration', () => {
  it('turns the Activity/Launch section bits and the card collapse into panel bits', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          sidebarWidth: 300,
          sessionPanelSections: { activity: true, launch: false, plan: true },
          sessionPanelCollapsed: true,
        },
        version: 4,
      }),
    );
    const fresh = await reloadStore();
    // Proves hydration actually ran, so the next assertions aren't vacuous.
    expect(fresh.getState().sidebarWidth).toBe(300);
    expect(fresh.getState().sessionPanelOpen).toEqual({ activity: true, launch: false, session: false });
    // Only the session card's own sections survive in the sections map.
    expect(fresh.getState().sessionPanelSections).toEqual({ plan: true });
    const state = fresh.getState() as unknown as Record<string, unknown>;
    expect(state.sessionPanelCollapsed).toBeUndefined();
    // ...and the retired key is not written back out on the next persist.
    fresh.getState().setSidebarWidth(320);
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.state.sessionPanelCollapsed).toBeUndefined();
    expect(parsed.state.sessionPanelOpen).toEqual({ activity: true, launch: false, session: false });
  });

  it('leaves the session card open when the old payload was not collapsed', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { sidebarWidth: 300, sessionPanelSections: { context: false }, sessionPanelCollapsed: false },
        version: 4,
      }),
    );
    const fresh = await reloadStore();
    expect(fresh.getState().sidebarWidth).toBe(300);
    expect(fresh.getState().sessionPanelOpen).toEqual({});
    expect(fresh.getState().sessionPanelSections).toEqual({ context: false });
  });

  it('leaves a v5 payload untouched', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { sidebarWidth: 300, sessionPanelOpen: { tasks: true, session: false }, sessionPanelSections: {} },
        version: 5,
      }),
    );
    const fresh = await reloadStore();
    expect(fresh.getState().sessionPanelOpen).toEqual({ tasks: true, session: false });
  });
});

describe('useUiPrefs v2 → v4 migration', () => {
  it('strips the retired inspector/files keys from an old payload', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { sidebarWidth: 300, inspectorVisible: true, workspaceFilesCollapsed: true },
        version: 2,
      }),
    );
    const fresh = await reloadStore();
    // Proves hydration actually ran, so the next assertions aren't vacuous.
    expect(fresh.getState().sidebarWidth).toBe(300);
    // v3 retired the right InspectorPane; v4 retired the docked Files sidebar —
    // the tree is a transient floating panel now, so neither flag survives.
    const state = fresh.getState() as unknown as Record<string, unknown>;
    expect(state.inspectorVisible).toBeUndefined();
    expect(state.workspaceFilesCollapsed).toBeUndefined();
    // ...and neither gets written back out on the next persist.
    fresh.getState().setSidebarWidth(320);
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.state.inspectorVisible).toBeUndefined();
    expect(parsed.state.workspaceFilesCollapsed).toBeUndefined();
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

  it('carries a v1 launch section bit through to the launch PANEL bit', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { sidebarVisible: false, sessionPanelSections: { launch: true } },
        version: 1,
      }),
    );
    const fresh = await reloadStore();
    expect(fresh.getState().sidebarVisible).toBe(false);
    expect(fresh.getState().sessionPanelOpen).toEqual({ launch: true });
    expect(fresh.getState().sessionPanelSections).toEqual({});
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
