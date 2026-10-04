// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'mf:ui-prefs';
const savedPreferences = {
  sidebarVisible: false,
  sidebarWidth: 320,
  sidebarView: 'tasks' as const,
  dontWarnOnTuningChange: true,
  sessionPanelOpen: true,
  sessionPanelSections: { plan: true, context: false },
  dialogSizes: { settings: { width: 920, height: 720 } },
  sideChatFrac: 0.6,
};

async function reloadStore() {
  vi.resetModules();
  const { useUiPrefs } = await import('../ui-prefs');
  await useUiPrefs.persist.rehydrate();
  return useUiPrefs;
}

beforeEach(() => localStorage.clear());

it('defaults to verbose with clean storage', async () => {
  const store = await reloadStore();
  expect(store.getState().transcriptMode).toBe('verbose');
});

it('persists compact across a fresh module and can return to verbose', async () => {
  const store = await reloadStore();
  store.setState(savedPreferences);
  store.getState().setTranscriptMode('compact');
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
    version: 8,
    state: { ...savedPreferences, transcriptMode: 'compact' },
  });
  const fresh = await reloadStore();
  expect(fresh.getState()).toMatchObject({ ...savedPreferences, transcriptMode: 'compact' });
  fresh.getState().setTranscriptMode('verbose');
  expect((await reloadStore()).getState()).toMatchObject({ ...savedPreferences, transcriptMode: 'verbose' });
});

it.each([7, 8])('defaults a missing transcript field in v%i without losing preferences', async (version) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: savedPreferences, version }));
  const store = await reloadStore();
  expect(store.getState()).toMatchObject({ ...savedPreferences, transcriptMode: 'verbose' });
});

it.each([
  [7, 'verbose'],
  [7, 'compact'],
  [8, 'verbose'],
  [8, 'compact'],
])('preserves a valid v%i transcript value %s', async (version, transcriptMode) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { ...savedPreferences, transcriptMode }, version }));
  const store = await reloadStore();
  expect(store.getState()).toMatchObject({ ...savedPreferences, transcriptMode });
});

const invalidValues = ['invalid', '', null, { mode: 'compact' }, ['compact'], false, 0];
it.each([7, 8].flatMap((version) => invalidValues.map((value) => ({ version, value }))))(
  'sanitizes v$version transcript value $value while retaining other preferences',
  async ({ version, value }) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { ...savedPreferences, transcriptMode: value }, version }),
    );
    const store = await reloadStore();
    expect(store.getState()).toMatchObject({ ...savedPreferences, transcriptMode: 'verbose' });
    store.getState().setSidebarWidth(330);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state).toEqual({
      ...savedPreferences,
      sidebarWidth: 330,
      transcriptMode: 'verbose',
    });
  },
);

it('keeps older section migrations when adding the transcript default', async () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      state: {
        sidebarWidth: 320,
        sessionPanelSections: { activity: true, launch: false, plan: true },
        sessionPanelCollapsed: true,
        bottomPanelTab: 'skills',
      },
    }),
  );
  const store = await reloadStore();
  expect(store.getState()).toMatchObject({
    sidebarWidth: 320,
    transcriptMode: 'verbose',
    sidebarView: 'chats',
    // v5 folds the legacy per-card bits into one map, v8 collapses that map to
    // ONE boolean: open because the 'activity' card was open.
    sessionPanelOpen: true,
    sessionPanelSections: { plan: true },
  });
  expect(store.getState()).not.toHaveProperty('bottomPanelTab');
});
