// @vitest-environment jsdom
/**
 * Integration test: open-file / reveal-file intent subscriber.
 * Tests the subscriber logic in isolation (not the React component).
 *
 * The subscriber:
 *  - on open-file: opens a preview tab in the workspace pane model, which lights
 *    the workspace surface
 *  - on open-file with position: also stashes a reveal target in the editor store
 *  - on reveal-file: lights the workspace and stashes the tree reveal target
 *  - normalizes mixed path flavors to a canonical relative key (F1 fix)
 *  - stamps the active session's launch scope onto every tab it opens
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { emitSurfaceIntent } from '../surface-intents';
import { useLayoutStore } from '../layout';
import { useEditorStore } from '../editor';
import { useFilesStore } from '../files';
import { useActiveBasesStore } from '../active-bases-store';
import { subscribeToFileIntents } from '../intent-subscriber';
import { useOverlaysStore } from '../overlays';
import { useWorkspaceFilesPanel } from '../workspace-files-panel';

const WORKTREE = '/Users/dev/myapp/.worktrees/feat-wt';
const PROJECT = '/Users/dev/myapp';

function isWorkspaceActive() {
  const { layout } = useLayoutStore.getState();
  return layout.top.includes('workspace') || layout.bottom === 'workspace';
}

/** Every tab across the workspace's panes, in strip order. */
function tabs() {
  return useLayoutStore.getState().run?.panes.flatMap((p) => p.tabs) ?? [];
}

function activeTabId() {
  const run = useLayoutStore.getState().run;
  return run?.panes[0]?.active ?? null;
}

beforeEach(() => {
  useLayoutStore.setState({
    layout: { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    run: null,
    sessions: new Map(),
    activeSessionId: null,
  });
  // Clear any stashed reveal targets between tests.
  useEditorStore.setState({ revealTargets: new Map() });
  useFilesStore.setState({ revealTarget: null });
  // Reset bases to empty by default (tests that need bases set them explicitly).
  useActiveBasesStore.setState({ bases: {}, scopeKey: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('open-file intent subscriber', () => {
  it('open-file opens a preview tab + lights the workspace surface', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: '/src/main.ts' });
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]!.path).toBe('/src/main.ts');
    expect(tabs()[0]!.mode).toBe('preview');
    expect(activeTabId()).toBe(tabs()[0]!.id);
    expect(isWorkspaceActive()).toBe(true);

    unsub();
  });

  it('a second open-file reuses the preview slot (does NOT accumulate tabs)', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: '/src/a.ts' });
    emitSurfaceIntent({ type: 'open-file', path: '/src/b.ts' });

    // Only one tab — the preview slot was replaced.
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]!.path).toBe('/src/b.ts');

    unsub();
  });

  it('opening an already-open file focuses it without adding a duplicate', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: '/src/a.ts' });
    const firstId = tabs()[0]!.id;

    emitSurfaceIntent({ type: 'open-file', path: '/src/a.ts' });
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]!.id).toBe(firstId);

    unsub();
  });

  it('workspace surface stays active after multiple open-file intents', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: '/a.ts' });
    emitSurfaceIntent({ type: 'open-file', path: '/b.ts' });

    expect(isWorkspaceActive()).toBe(true);

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

  it('open-file with position still opens the tab + lights the workspace', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: '/src/lib.ts', line: 10, character: 0 });
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]!.path).toBe('/src/lib.ts');
    expect(isWorkspaceActive()).toBe(true);

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
  it('reveal-file lights the workspace surface AND opens the Files panel', () => {
    // A file revealed into a closed panel is a file the user cannot see.
    const unsub = subscribeToFileIntents();
    useWorkspaceFilesPanel.setState({ open: false });

    expect(isWorkspaceActive()).toBe(false);
    emitSurfaceIntent({ type: 'reveal-file', path: '/src/main.ts' });
    expect(isWorkspaceActive()).toBe(true);
    expect(useWorkspaceFilesPanel.getState().open).toBe(true);

    unsub();
  });

  it('reveal-file does not add extra tabs', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'reveal-file', path: '/src/main.ts' });

    // reveal-file does NOT open a tab — it only activates the surface.
    expect(tabs()).toHaveLength(0);

    unsub();
  });

  it('reveal-file stashes a reveal target in the files store', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'reveal-file', path: 'src/lib/util.ts' });

    expect(useFilesStore.getState().revealTarget).toBe('src/lib/util.ts');

    unsub();
  });

  it('reveal-file normalizes path via active bases before stashing', () => {
    useActiveBasesStore.setState({ bases: { projectPath: '/Users/dev/myapp' } });
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'reveal-file', path: '/Users/dev/myapp/src/index.ts' });

    // Should normalize to the base-relative path, same as open-file.
    expect(useFilesStore.getState().revealTarget).toBe('src/index.ts');

    unsub();
  });
});

// ── F1 regression: path-flavor normalization ──────────────────────────────────

describe('F1 regression: path-flavor normalization prevents duplicate tabs', () => {
  it('absolute tool-card path and tree-relative path open the SAME tab', () => {
    useActiveBasesStore.setState({ bases: { worktreePath: WORKTREE, projectPath: PROJECT } });
    const unsub = subscribeToFileIntents();

    // Simulate a chat tool-card emitting an absolute path.
    emitSurfaceIntent({ type: 'open-file', path: `${WORKTREE}/src/a.ts` });
    const afterFirst = tabs();
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]!.path).toBe('src/a.ts');

    // Simulate the file-tree emitting the relative path — must NOT create a new tab.
    emitSurfaceIntent({ type: 'open-file', path: 'src/a.ts' });
    const afterSecond = tabs();
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]!.path).toBe('src/a.ts');

    unsub();
  });

  it('file:// URI and tree-relative path open the SAME tab', () => {
    useActiveBasesStore.setState({ bases: { worktreePath: WORKTREE, projectPath: PROJECT } });
    const unsub = subscribeToFileIntents();

    // Simulate LSP go-to-def emitting a file:// URI.
    emitSurfaceIntent({ type: 'open-file', path: `file://${WORKTREE}/src/b.ts` });
    const afterFirst = tabs();
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]!.path).toBe('src/b.ts');

    // Same file from file-tree — must NOT create a second tab.
    emitSurfaceIntent({ type: 'open-file', path: 'src/b.ts' });
    const afterSecond = tabs();
    expect(afterSecond).toHaveLength(1);

    unsub();
  });

  it('absolute path under project base (no worktree) normalizes correctly', () => {
    useActiveBasesStore.setState({ bases: { projectPath: PROJECT } });
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: `${PROJECT}/lib/util.ts` });
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]!.path).toBe('lib/util.ts');

    // Relative form is the same tab.
    emitSurfaceIntent({ type: 'open-file', path: 'lib/util.ts' });
    expect(tabs()).toHaveLength(1);

    unsub();
  });

  it('external path (no base match) uses the absolute path as the tab key', () => {
    useActiveBasesStore.setState({ bases: { worktreePath: WORKTREE, projectPath: PROJECT } });
    const unsub = subscribeToFileIntents();

    const extPath = '/usr/local/share/system.ts';
    emitSurfaceIntent({ type: 'open-file', path: extPath });
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]!.path).toBe(extPath);

    unsub();
  });

  it('without active bases, relative paths still work as tab keys', () => {
    // bases = {} — no normalization context but shouldn't crash.
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: 'src/c.ts' });
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]!.path).toBe('src/c.ts');

    unsub();
  });
});

describe('scope stamping', () => {
  it('stamps the active session launch scope onto an opened file tab', () => {
    useActiveBasesStore.setState({ bases: { projectPath: PROJECT }, scopeKey: 'proj-1:/Users/dev/myapp' });
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: 'src/a.ts' });

    expect(tabs()[0]!.scopeKey).toBe('proj-1:/Users/dev/myapp');
    unsub();
  });

  it('stamps the scope onto a diff tab too', () => {
    useActiveBasesStore.setState({ bases: { projectPath: PROJECT }, scopeKey: 'proj-1:/Users/dev/myapp' });
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-diff', path: 'src/a.ts' });

    expect(tabs()[0]!.scopeKey).toBe('proj-1:/Users/dev/myapp');
    unsub();
  });

  it('leaves scopeKey undefined on a draft session with no resolved scope', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-file', path: 'src/a.ts' });

    expect(tabs()[0]!.scopeKey).toBeUndefined();
    unsub();
  });

  it('the same path under a DIFFERENT scope opens its own tab (no cross-project leak)', () => {
    useActiveBasesStore.setState({ bases: {}, scopeKey: 'proj-a:/a' });
    const unsub = subscribeToFileIntents();
    emitSurfaceIntent({ type: 'open-file', path: 'src/a.ts' });

    useActiveBasesStore.setState({ bases: {}, scopeKey: 'proj-b:/b' });
    emitSurfaceIntent({ type: 'open-file', path: 'src/a.ts' });

    expect(tabs().map((t) => t.scopeKey)).toEqual(['proj-a:/a', 'proj-b:/b']);
    unsub();
  });
});

describe('intent-subscriber overlay intents', () => {
  beforeEach(() => {
    useOverlaysStore.setState({ paletteOpen: false, findInPath: null, reviewOpen: false });
  });

  it('open-search-palette sets paletteOpen', () => {
    const unsub = subscribeToFileIntents();
    emitSurfaceIntent({ type: 'open-search-palette' });
    expect(useOverlaysStore.getState().paletteOpen).toBe(true);
    unsub();
  });

  it('open-find-in-path sets the scope', () => {
    const unsub = subscribeToFileIntents();
    emitSurfaceIntent({ type: 'open-find-in-path', scopePath: 'src', scopeType: 'directory' });
    expect(useOverlaysStore.getState().findInPath).toEqual({ scopePath: 'src', scopeType: 'directory' });
    unsub();
  });

  it('open-review sets reviewOpen', () => {
    const unsub = subscribeToFileIntents();
    emitSurfaceIntent({ type: 'open-review' });
    expect(useOverlaysStore.getState().reviewOpen).toBe(true);
    unsub();
  });
});

describe('open-diff intent subscriber', () => {
  it('open-diff with original/modified opens ONE preview tab of kind diff and lights the workspace surface', () => {
    const unsub = subscribeToFileIntents();

    // Cast through unknown to allow fields not yet on the type (TDD red phase).
    emitSurfaceIntent({
      type: 'open-diff',
      path: '/src/x.ts',
      original: 'before\n',
      modified: 'after\n',
    } as unknown as Parameters<typeof emitSurfaceIntent>[0]);
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]!.kind).toBe('diff');
    expect(tabs()[0]!.mode).toBe('preview');
    expect(activeTabId()).toBe(tabs()[0]!.id);
    // original / modified must be forwarded onto the tab model.
    const diffTab = tabs()[0] as import('../run-pane').RunTab;
    expect(diffTab.original).toBe('before\n');
    expect(diffTab.modified).toBe('after\n');
    // workspace surface must be activated.
    expect(isWorkspaceActive()).toBe(true);

    unsub();
  });

  it('open-diff normalizes an absolute path under the active worktree base to a base-relative tab path', () => {
    useActiveBasesStore.setState({ bases: { worktreePath: WORKTREE, projectPath: PROJECT } });
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({
      type: 'open-diff',
      path: `${WORKTREE}/src/x.ts`,
      original: 'a',
      modified: 'b',
    } as unknown as Parameters<typeof emitSurfaceIntent>[0]);
    expect(tabs()).toHaveLength(1);
    // Must be stripped to the worktree-relative form.
    expect(tabs()[0]!.path).toBe('src/x.ts');

    unsub();
  });

  it('open-diff WITHOUT original/modified still opens a kind:diff tab with sides undefined (HEAD-vs-working case)', () => {
    const unsub = subscribeToFileIntents();

    emitSurfaceIntent({ type: 'open-diff', path: '/src/y.ts' });
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]!.kind).toBe('diff');
    const diffTab = tabs()[0] as import('../run-pane').RunTab;
    expect(diffTab.original).toBeUndefined();
    expect(diffTab.modified).toBeUndefined();

    unsub();
  });
});
