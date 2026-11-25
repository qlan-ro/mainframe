// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'mf:ui-prefs';
const savedPreferences = {
  sidebarVisible: false,
  sidebarWidth: 320,
  sidebarView: 'tasks' as const,
  dontWarnOnTuningChange: true,
  dontConfirmProviderSwitch: false,
  sessionPanelOpen: true,
  sessionPanelSections: { plan: true, context: false },
  sessionPanelHiddenSections: ['launch' as const],
  dialogSizes: { settings: { width: 920, height: 720 } },
  sideChatFrac: 0.6,
  transcriptWidth: 900,
};

async function reloadStore() {
  vi.resetModules();
  const { useUiPrefs } = await import('../ui-prefs');
  await useUiPrefs.persist.rehydrate();
  return useUiPrefs;
}

beforeEach(() => localStorage.clear());

it('folds finished work and opens links in the workspace with clean storage', async () => {
  const store = await reloadStore();
  expect(store.getState()).toMatchObject({ finishedWork: 'fold', openLinksIn: 'workspace' });
});

it('persists both choices across a fresh module', async () => {
  const store = await reloadStore();
  store.setState(savedPreferences);
  store.getState().setFinishedWork('open');
  store.getState().setOpenLinksIn('browser');
  const chosen = { ...savedPreferences, finishedWork: 'open', openLinksIn: 'browser' };
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state).toMatchObject(chosen);
  expect((await reloadStore()).getState()).toMatchObject(chosen);
});

/** What main's partializer writes for `transcriptMode`: always, so `verbose` is the default too. */
it.each([
  [7, { transcriptMode: 'verbose' }, 'open'],
  [8, { transcriptMode: 'verbose' }, 'open'],
  [7, { transcriptMode: 'compact' }, 'fold'],
  [8, { transcriptMode: 'compact' }, 'fold'],
  [7, {}, 'fold'],
  [8, {}, 'fold'],
  // The new choice, once made, wins over what an older build may write beside it.
  [8, { transcriptMode: 'verbose', finishedWork: 'fold' }, 'fold'],
  [8, { transcriptMode: 'compact', finishedWork: 'open' }, 'open'],
])('carries the retired choice of v%i storage over: %o starts on %s', async (version, stored, finishedWork) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { ...savedPreferences, ...stored }, version }));
  const store = await reloadStore();
  expect(store.getState()).toMatchObject({ ...savedPreferences, finishedWork, openLinksIn: 'workspace' });
  expect(store.getState()).not.toHaveProperty('transcriptMode');
  // The next write keeps the choice, without the field it came from.
  store.getState().setSidebarWidth(330);
  const written = JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
  expect(written).toMatchObject({ finishedWork });
  expect(written).not.toHaveProperty('transcriptMode');
  expect((await reloadStore()).getState()).toMatchObject({ finishedWork });
});

it('carries it over from storage older than v7', async () => {
  const state = { sidebarWidth: 320, transcriptMode: 'verbose' };
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 4 }));
  expect((await reloadStore()).getState()).toMatchObject({ sidebarWidth: 320, finishedWork: 'open' });
});

const invalidValues = ['invalid', '', null, { mode: 'open' }, ['open'], false, 0];
it.each([7, 8].flatMap((version) => invalidValues.map((value) => ({ version, value }))))(
  'sanitizes $value in v$version while retaining other preferences',
  async ({ version, value }) => {
    const state = { ...savedPreferences, finishedWork: value, openLinksIn: value };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version }));
    const store = await reloadStore();
    store.getState().setSidebarWidth(330);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state).toEqual({
      ...savedPreferences,
      sidebarWidth: 330,
      finishedWork: 'fold',
      openLinksIn: 'workspace',
    });
  },
);

it('keeps older section migrations when adding the transcript defaults', async () => {
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
    finishedWork: 'fold',
    sidebarView: 'chats',
    // v5 folds the legacy per-card bits into one map, v8 collapses that map to
    // ONE boolean: open because the 'activity' card was open.
    sessionPanelOpen: true,
    sessionPanelSections: { plan: true },
  });
  expect(store.getState()).not.toHaveProperty('bottomPanelTab');
});

it('defaults the transcript width to 680 and persists a dragged width', async () => {
  const store = await reloadStore();
  expect(store.getState().transcriptWidth).toBe(680);
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
  ['missing', undefined, 680],
  ['a string', '900', 680],
  ['NaN', Number.NaN, 680],
  ['too narrow', 10, 480],
  ['too wide', 9000, 1600],
])('sanitizes a %s persisted transcript width', async (_label, transcriptWidth, expected) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { ...savedPreferences, transcriptWidth }, version: 8 }));
  const store = await reloadStore();
  expect(store.getState().transcriptWidth).toBe(expected);
});
