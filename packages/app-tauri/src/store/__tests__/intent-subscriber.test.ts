/**
 * Integration test: open-file / reveal-file intent subscriber.
 * Tests the subscriber logic in isolation (not the React component).
 *
 * The subscriber:
 *  - on open-file: calls openTab + activates the Files surface
 *  - on open-file with position: also stashes a reveal target in the editor store
 *  - on reveal-file: activates the Files surface (tree reveal is a TODO)
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { emitSurfaceIntent } from '../surface-intents';
import { useLayoutStore } from '../layout';
import { useTabsStore } from '../tabs';
import { useEditorStore } from '../editor';
import { subscribeToFileIntents } from '../intent-subscriber';

function isFilesActive() {
  const { layout } = useLayoutStore.getState();
  return layout.top.includes('files') || layout.bottom === 'files';
}

beforeEach(() => {
  useLayoutStore.setState({ layout: { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } } });
  useTabsStore.setState({ tabs: [], activeTabId: null });
  // Clear any stashed reveal targets between tests.
  useEditorStore.setState({ revealTargets: new Map() });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('open-file intent subscriber', () => {
  it('open-file opens a preview tab + activates Files surface', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: '/src/main.ts' });

    const { tabs, activeTabId } = useTabsStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.path).toBe('/src/main.ts');
    expect(tabs[0]!.mode).toBe('preview');
    expect(activeTabId).toBe(tabs[0]!.id);
    expect(isFilesActive()).toBe(true);

    unsub();
  });

  it('a second open-file reuses the preview slot (does NOT accumulate tabs)', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: '/src/a.ts' });
    emitSurfaceIntent({ type: 'open-file', path: '/src/b.ts' });

    const { tabs } = useTabsStore.getState();
    // Only one tab — the preview slot was replaced.
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.path).toBe('/src/b.ts');

    unsub();
  });

  it('opening an already-open file focuses it without adding a duplicate', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: '/src/a.ts' });
    const firstId = useTabsStore.getState().tabs[0]!.id;

    emitSurfaceIntent({ type: 'open-file', path: '/src/a.ts' });

    const { tabs } = useTabsStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.id).toBe(firstId);

    unsub();
  });

  it('Files surface stays active after multiple open-file intents', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: '/a.ts' });
    emitSurfaceIntent({ type: 'open-file', path: '/b.ts' });

    expect(isFilesActive()).toBe(true);

    unsub();
  });

  // --- review #8: reveal target ---

  it('open-file WITHOUT position does NOT stash a reveal target', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: '/src/main.ts' });

    const target = useEditorStore.getState().getRevealTarget('/src/main.ts');
    expect(target).toBeUndefined();

    unsub();
  });

  it('open-file WITH line+character stashes a reveal target in the editor store', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: '/src/lib.ts', line: 42, character: 7 });

    const target = useEditorStore.getState().getRevealTarget('/src/lib.ts');
    expect(target).toEqual({ line: 42, character: 7 });

    unsub();
  });

  it('open-file with position still opens the tab + activates Files', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: '/src/lib.ts', line: 10, character: 0 });

    const { tabs } = useTabsStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.path).toBe('/src/lib.ts');
    expect(isFilesActive()).toBe(true);

    unsub();
  });

  it('open-file with only line (no character) does not stash (character required)', () => {
    const unsub = subscribeToFileIntents();

    // TypeScript ensures character is also required when line is present.
    // The subscriber only stashes when BOTH line and character are defined numbers.
    emitSurfaceIntent({ type: 'open-file', path: '/src/lib.ts', line: 5 });

    // No reveal target because character is undefined.
    const target = useEditorStore.getState().getRevealTarget('/src/lib.ts');
    expect(target).toBeUndefined();

    unsub();
  });
});

describe('reveal-file intent subscriber', () => {
  it('reveal-file activates Files surface', () => {
    const unsub = subscribeToFileIntents();

    expect(isFilesActive()).toBe(false);
    emitSurfaceIntent({ type: 'reveal-file', path: '/src/main.ts' });
    expect(isFilesActive()).toBe(true);

    unsub();
  });

  it('reveal-file does not add extra tabs', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'reveal-file', path: '/src/main.ts' });

    // reveal-file does NOT open a tab — it only activates the surface.
    const { tabs } = useTabsStore.getState();
    expect(tabs).toHaveLength(0);

    unsub();
  });
});
