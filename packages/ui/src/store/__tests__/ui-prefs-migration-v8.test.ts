// @vitest-environment jsdom
/**
 * ui-prefs v7 → v8 migration, split out of ui-prefs-migration.test.ts to keep
 * both files under the 300-line cap.
 *
 * v8 collapses the four stacked cards' open bits (`sessionPanelOpen`, a
 * per-card map) into ONE boolean for the whole docked panel — open if ANY
 * card was open, where an absent key reads as that card's old default
 * (session: true, activity/launch/tasks: false). It also renames the sidebar's
 * legacy 256px default to 260, and introduces `sidebarView`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

const STORAGE_KEY = 'mf:ui-prefs';

async function reloadStore() {
  vi.resetModules();
  const mod = await import('../ui-prefs');
  await mod.useUiPrefs.persist.rehydrate();
  return mod.useUiPrefs;
}

function seed(state: Record<string, unknown>, version = 7) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version }));
}

beforeEach(() => {
  localStorage.clear();
});

describe('D8: v7 → v8 — sessionPanelOpen map collapses to one boolean', () => {
  it('an empty map opens the panel — every absent key reads as its own default, and session defaulted open', async () => {
    seed({ sidebarWidth: 300, sessionPanelOpen: {} });
    const fresh = await reloadStore();
    expect(fresh.getState().sidebarWidth).toBe(300); // proves hydration ran
    expect(fresh.getState().sessionPanelOpen).toBe(true);
  });

  it('an explicit session:false with nothing else open closes the panel', async () => {
    seed({ sidebarWidth: 300, sessionPanelOpen: { session: false } });
    const fresh = await reloadStore();
    expect(fresh.getState().sessionPanelOpen).toBe(false);
  });

  it('opens the panel when a NON-session card was open, even with session closed', async () => {
    seed({ sidebarWidth: 300, sessionPanelOpen: { session: false, tasks: true } });
    const fresh = await reloadStore();
    expect(fresh.getState().sessionPanelOpen).toBe(true);
  });

  it('closes the panel when every card is explicitly closed', async () => {
    seed({ sidebarWidth: 300, sessionPanelOpen: { session: false, activity: false, launch: false, tasks: false } });
    const fresh = await reloadStore();
    expect(fresh.getState().sessionPanelOpen).toBe(false);
  });

  it('a boolean sessionPanelOpen (already v8 shape) is left untouched', async () => {
    seed({ sidebarWidth: 300, sessionPanelOpen: false });
    const fresh = await reloadStore();
    expect(fresh.getState().sessionPanelOpen).toBe(false);
  });

  it('does not write the retired per-card map back out on the next persist', async () => {
    seed({ sidebarWidth: 300, sessionPanelOpen: { tasks: true } });
    const fresh = await reloadStore();
    fresh.getState().setSidebarWidth(320);
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.state.sessionPanelOpen).toBe(true);
  });
});

describe('D13: v7 → v8 — the legacy 256px sidebar default renames to 260', () => {
  it('maps a persisted legacy default (256) to the new default (260)', async () => {
    seed({ sidebarWidth: 256, sessionPanelOpen: {} });
    const fresh = await reloadStore();
    expect(fresh.getState().sidebarWidth).toBe(260);
  });

  it('leaves a width the user actually dragged to untouched', async () => {
    seed({ sidebarWidth: 340, sessionPanelOpen: {} });
    const fresh = await reloadStore();
    expect(fresh.getState().sidebarWidth).toBe(340);
  });

  it('leaves the new default (260) untouched, not double-mapped', async () => {
    seed({ sidebarWidth: 260, sessionPanelOpen: {} });
    const fresh = await reloadStore();
    expect(fresh.getState().sidebarWidth).toBe(260);
  });
});

describe('D4: v7 → v8 — sidebarView is sanitized to a known view', () => {
  it('fills the default ("chats") when the payload predates sidebarView', async () => {
    seed({ sidebarWidth: 300, sessionPanelOpen: {} });
    const fresh = await reloadStore();
    expect(fresh.getState().sidebarView).toBe('chats');
  });

  it('keeps a persisted valid view', async () => {
    seed({ sidebarWidth: 300, sessionPanelOpen: {}, sidebarView: 'automations' });
    const fresh = await reloadStore();
    expect(fresh.getState().sidebarView).toBe('automations');
  });

  it('falls back to "chats" on a corrupt/unknown value', async () => {
    seed({ sidebarWidth: 300, sessionPanelOpen: {}, sidebarView: 'kanban' });
    const fresh = await reloadStore();
    expect(fresh.getState().sidebarView).toBe('chats');
  });
});

describe('v8 payload passthrough', () => {
  it('leaves an already-v8 payload untouched', async () => {
    seed(
      {
        sidebarWidth: 300,
        sidebarView: 'tasks',
        sessionPanelOpen: false,
        sessionPanelSections: {},
      },
      8,
    );
    const fresh = await reloadStore();
    expect(fresh.getState().sidebarWidth).toBe(300);
    expect(fresh.getState().sidebarView).toBe('tasks');
    expect(fresh.getState().sessionPanelOpen).toBe(false);
  });
});

describe('older chain still lands on v8 shape', () => {
  it('a v5 payload (per-card map, no sidebarView) ends up boolean + "chats"', async () => {
    seed({ sidebarWidth: 300, sessionPanelOpen: { tasks: true, session: false }, sessionPanelSections: {} }, 5);
    const fresh = await reloadStore();
    expect(fresh.getState().sessionPanelOpen).toBe(true);
    expect(fresh.getState().sidebarView).toBe('chats');
  });
});
