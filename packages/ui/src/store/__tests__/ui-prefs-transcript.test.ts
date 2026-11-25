// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'mf:ui-prefs';
// The v9 persisted shape. Older versions are written without the two v9 fields.
const savedPreferences = {
  sidebarVisible: false,
  sidebarWidth: 320,
  sidebarView: 'tasks' as const,
  dontWarnOnTuningChange: true,
  enterWhileRunning: 'queue' as const,
  activityStripCollapsed: false,
  sessionPanelOpen: true,
  sessionPanelSections: { plan: true, context: false },
  sessionPanelHiddenSections: ['launch' as const],
  dialogSizes: { settings: { width: 920, height: 720 } },
  transcriptWidth: 900,
};

/** What a v7/v8 install had on disk: no v9 fields, and the removed confirm flag. */
const legacyPreferences = (() => {
  const { enterWhileRunning: _a, activityStripCollapsed: _b, ...rest } = savedPreferences;
  return { ...rest, dontConfirmProviderSwitch: true };
})();

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
    version: 9,
    state: { ...savedPreferences, transcriptMode: 'compact' },
  });
  const fresh = await reloadStore();
  expect(fresh.getState()).toMatchObject({ ...savedPreferences, transcriptMode: 'compact' });
  fresh.getState().setTranscriptMode('verbose');
  expect((await reloadStore()).getState()).toMatchObject({ ...savedPreferences, transcriptMode: 'verbose' });
});

it.each([7, 8])('defaults a missing transcript field in v%i without losing preferences', async (version) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: legacyPreferences, version }));
  const store = await reloadStore();
  expect(store.getState()).toMatchObject({ ...savedPreferences, transcriptMode: 'verbose' });
});

it.each([
  [7, 'verbose'],
  [7, 'compact'],
  [8, 'verbose'],
  [8, 'compact'],
])('preserves a valid v%i transcript value %s', async (version, transcriptMode) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { ...legacyPreferences, transcriptMode }, version }));
  const store = await reloadStore();
  expect(store.getState()).toMatchObject({ ...savedPreferences, transcriptMode });
});

const invalidValues = ['invalid', '', null, { mode: 'compact' }, ['compact'], false, 0];
it.each([7, 8].flatMap((version) => invalidValues.map((value) => ({ version, value }))))(
  'sanitizes v$version transcript value $value while retaining other preferences',
  async ({ version, value }) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { ...legacyPreferences, transcriptMode: value }, version }),
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

it('defaults the transcript width to 780 and persists a dragged width', async () => {
  const store = await reloadStore();
  expect(store.getState().transcriptWidth).toBe(780);
  store.getState().setTranscriptWidth(1000.4);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.transcriptWidth).toBe(1000);
  expect((await reloadStore()).getState().transcriptWidth).toBe(1000);
});

it('clamps the transcript width to 480–1600', async () => {
  const store = await reloadStore();
  store.getState().setTranscriptWidth(100);
  expect(store.getState().transcriptWidth).toBe(480);
  store.getState().setTranscriptWidth(5000);
  expect(store.getState().transcriptWidth).toBe(1600);
});

it.each([
  ['missing', undefined, 780],
  ['a string', '900', 780],
  ['NaN', Number.NaN, 780],
  ['too narrow', 10, 480],
  ['too wide', 9000, 1600],
])('sanitizes a %s persisted transcript width', async (_label, transcriptWidth, expected) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { ...savedPreferences, transcriptWidth }, version: 9 }));
  const store = await reloadStore();
  expect(store.getState().transcriptWidth).toBe(expected);
});

it('migrates a persisted 680px width (the pre-v9 default) to 780', async () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ state: { ...legacyPreferences, transcriptWidth: 680 }, version: 8 }),
  );
  expect((await reloadStore()).getState().transcriptWidth).toBe(780);
});

it('keeps a dragged width through the v9 migration', async () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ state: { ...legacyPreferences, transcriptWidth: 900 }, version: 8 }),
  );
  expect((await reloadStore()).getState().transcriptWidth).toBe(900);
});

it('drops the removed dontConfirmProviderSwitch flag on the next write', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: legacyPreferences, version: 8 }));
  const store = await reloadStore();
  expect(store.getState()).not.toHaveProperty('dontConfirmProviderSwitch');
  store.getState().setSidebarWidth(330);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state).not.toHaveProperty('dontConfirmProviderSwitch');
});

it('defaults Enter-while-running to queue and the activity strip to expanded', async () => {
  const store = await reloadStore();
  expect(store.getState()).toMatchObject({ enterWhileRunning: 'queue', activityStripCollapsed: false });
});

it('persists enterWhileRunning and activityStripCollapsed across a reload', async () => {
  const store = await reloadStore();
  store.getState().setEnterWhileRunning('steer');
  store.getState().setActivityStripCollapsed(true);
  expect((await reloadStore()).getState()).toMatchObject({ enterWhileRunning: 'steer', activityStripCollapsed: true });
});

it.each(['later', '', null, 1, { mode: 'steer' }])('sanitizes enterWhileRunning %j to queue', async (value) => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ state: { ...savedPreferences, enterWhileRunning: value }, version: 9 }),
  );
  expect((await reloadStore()).getState().enterWhileRunning).toBe('queue');
});

it.each(['true', 1, null])('sanitizes activityStripCollapsed %j to false', async (value) => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ state: { ...savedPreferences, activityStripCollapsed: value }, version: 9 }),
  );
  expect((await reloadStore()).getState().activityStripCollapsed).toBe(false);
});
