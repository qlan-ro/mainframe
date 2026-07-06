/**
 * FileTree reveal-target tests.
 *
 * When the files store has a revealTarget the tree should:
 *  1. Expand all ancestor directories of the target path.
 *  2. Scroll the target row into view.
 *  3. Transiently highlight (data-highlighted) the target row.
 *  4. Consume the reveal target (clear it from the store).
 *
 * scrollIntoView is not implemented in jsdom — we stub it via vi.fn() on the
 * prototype before each test that needs it.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { FileTreeEntry } from '@/lib/api/files';
import { useFilesStore } from '@/store/files';
import { ActiveDaemonProvider } from '@/features/daemon/active-daemon-context';

// ── mocks ─────────────────────────────────────────────────────────────────────

const getFileTree = vi.fn();
const emitSurfaceIntent = vi.fn();

vi.mock('@/lib/api/files', () => ({ getFileTree: (...a: unknown[]) => getFileTree(...a) }));
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => emitSurfaceIntent(...a) }));
vi.mock('@/lib/daemon/dispose-daemon-session', () => ({ disposeDaemonSession: vi.fn() }));
vi.mock('@/lib/daemon/ws-client', () => ({ daemonWs: { setPort: vi.fn(), connect: vi.fn() } }));
vi.mock('@/lib/lsp', () => ({ rebindLspToActiveDaemon: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/features/daemon/reset-daemon-scoped-stores', () => ({
  resetDaemonScopedStores: vi.fn(),
}));

import { FileTree } from '../FileTree';

// ── helpers ───────────────────────────────────────────────────────────────────

const dir = (name: string, path: string): FileTreeEntry => ({ name, path, type: 'directory' });
const file = (name: string, path: string): FileTreeEntry => ({ name, path, type: 'file' });

// FileTree renders FileTreeRowMenu, which reads the active daemon via
// useDaemonIsLocal(). Wrap every render in the provider so that hook resolves.
function render(ui: ReactElement) {
  return rtlRender(<ActiveDaemonProvider>{ui}</ActiveDaemonProvider>);
}

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  getFileTree.mockReset();
  emitSurfaceIntent.mockReset();
  useFilesStore.setState({ revealTarget: null });

  // jsdom does not implement scrollIntoView; stub it so assertions work.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('FileTree reveal-target: ancestor expansion', () => {
  it('expands the ancestor directory automatically when a reveal target is set', async () => {
    // Root contains src/ directory.
    getFileTree.mockResolvedValueOnce([dir('src', 'src')]);
    // src/ children (fetched when src is expanded).
    getFileTree.mockResolvedValueOnce([file('util.ts', 'src/util.ts')]);

    // Set the reveal target BEFORE rendering so the tree can read it on mount.
    useFilesStore.getState().setRevealTarget('src/util.ts');

    render(<FileTree port={1} projectId="p1" />);

    // src/util.ts should appear after the tree auto-expands src/.
    await waitFor(() => expect(screen.queryByTestId('file-tree-row-src/util.ts')).not.toBeNull());
  });

  it('expands two levels of nesting when the reveal target is deeply nested', async () => {
    // Root contains lib/ directory.
    getFileTree.mockResolvedValueOnce([dir('lib', 'lib')]);
    // lib/ contains sub/.
    getFileTree.mockResolvedValueOnce([dir('sub', 'lib/sub')]);
    // lib/sub/ contains deep.ts.
    getFileTree.mockResolvedValueOnce([file('deep.ts', 'lib/sub/deep.ts')]);

    useFilesStore.getState().setRevealTarget('lib/sub/deep.ts');

    render(<FileTree port={1} projectId="p1" />);

    await waitFor(() => expect(screen.queryByTestId('file-tree-row-lib/sub/deep.ts')).not.toBeNull());
  });
});

describe('FileTree reveal-target: collapse after reveal (regression)', () => {
  it('lets the user collapse a folder that a reveal auto-expanded (no re-open latch)', async () => {
    getFileTree.mockResolvedValueOnce([dir('src', 'src')]); // root
    getFileTree.mockResolvedValueOnce([file('util.ts', 'src/util.ts')]); // src children

    // Reveal a file under src/ — src/ auto-expands and stays an ancestor of the target.
    useFilesStore.getState().setRevealTarget('src/util.ts');
    render(<FileTree port={1} projectId="p1" />);
    await waitFor(() => expect(screen.queryByTestId('file-tree-row-src/util.ts')).not.toBeNull());

    // User collapses src/. The auto-expand effect re-fires (open→false) but must
    // NOT re-open it — otherwise the folder is un-collapsible.
    fireEvent.click(screen.getByTestId('file-tree-row-src'));
    await waitFor(() => expect(screen.queryByTestId('file-tree-row-src/util.ts')).toBeNull());
    // Still collapsed after the effect has had a chance to re-run.
    expect(screen.queryByTestId('file-tree-row-src/util.ts')).toBeNull();
  });
});

describe('FileTree reveal-target: scroll and highlight', () => {
  it('calls scrollIntoView on the target row after expansion', async () => {
    getFileTree.mockResolvedValueOnce([dir('src', 'src')]);
    getFileTree.mockResolvedValueOnce([file('index.ts', 'src/index.ts')]);

    useFilesStore.getState().setRevealTarget('src/index.ts');

    render(<FileTree port={1} projectId="p1" />);

    await waitFor(() => expect(screen.queryByTestId('file-tree-row-src/index.ts')).not.toBeNull());

    const row = screen.getByTestId('file-tree-row-src/index.ts');
    expect(row.scrollIntoView).toHaveBeenCalled();
  });

  it('adds data-highlighted to the target row', async () => {
    getFileTree.mockResolvedValueOnce([dir('src', 'src')]);
    getFileTree.mockResolvedValueOnce([file('index.ts', 'src/index.ts')]);

    useFilesStore.getState().setRevealTarget('src/index.ts');

    render(<FileTree port={1} projectId="p1" />);

    await waitFor(() => expect(screen.queryByTestId('file-tree-row-src/index.ts')).not.toBeNull());

    const row = screen.getByTestId('file-tree-row-src/index.ts');
    expect(row).toHaveAttribute('data-highlighted', 'true');
  });
});

describe('FileTree reveal-target: while-mounted (primary use case)', () => {
  it('reveals a file when the reveal target is set after the tree is already mounted', async () => {
    // Root contains src/ directory.
    getFileTree.mockResolvedValueOnce([dir('src', 'src')]);
    // src/ children fetched on auto-expand.
    getFileTree.mockResolvedValueOnce([file('main.ts', 'src/main.ts')]);

    // Render with NO reveal target — tree is already mounted.
    render(<FileTree port={1} projectId="p1" />);
    // Wait for root to be rendered.
    await screen.findByTestId('file-tree');

    // Now set the reveal target via the store — simulating the ViewerShell "Reveal" button.
    act(() => {
      useFilesStore.getState().setRevealTarget('src/main.ts');
    });

    // The tree should auto-expand src/ and show the target file.
    await waitFor(() => expect(screen.queryByTestId('file-tree-row-src/main.ts')).not.toBeNull());

    const row = screen.getByTestId('file-tree-row-src/main.ts');
    expect(row).toHaveAttribute('data-highlighted', 'true');
    expect(row.scrollIntoView).toHaveBeenCalled();
    // Store should be cleared after consumption.
    expect(useFilesStore.getState().revealTarget).toBeNull();
  });

  it('a second reveal while mounted updates to the new target path', async () => {
    getFileTree.mockResolvedValueOnce([dir('src', 'src'), dir('lib', 'lib')]);
    // src/ children for first reveal.
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    // lib/ children for second reveal.
    getFileTree.mockResolvedValueOnce([file('b.ts', 'lib/b.ts')]);

    // Render with first reveal already pending.
    useFilesStore.getState().setRevealTarget('src/a.ts');
    render(<FileTree port={1} projectId="p1" />);
    await waitFor(() => expect(screen.queryByTestId('file-tree-row-src/a.ts')).not.toBeNull());

    const firstRow = screen.getByTestId('file-tree-row-src/a.ts');
    expect(firstRow).toHaveAttribute('data-highlighted', 'true');

    // Trigger a second reveal for a different path while the tree is mounted.
    act(() => {
      useFilesStore.getState().setRevealTarget('lib/b.ts');
    });

    await waitFor(() => expect(screen.queryByTestId('file-tree-row-lib/b.ts')).not.toBeNull());

    const secondRow = screen.getByTestId('file-tree-row-lib/b.ts');
    expect(secondRow).toHaveAttribute('data-highlighted', 'true');
    expect(useFilesStore.getState().revealTarget).toBeNull();
  });
});

describe('FileTree reveal-target: consume-once', () => {
  it('clears the files store reveal target after processing', async () => {
    getFileTree.mockResolvedValueOnce([file('a.ts', 'a.ts')]);

    useFilesStore.getState().setRevealTarget('a.ts');

    render(<FileTree port={1} projectId="p1" />);

    await waitFor(() => expect(screen.queryByTestId('file-tree-row-a.ts')).not.toBeNull());

    // The store should be cleared so a second mount does NOT re-reveal.
    expect(useFilesStore.getState().revealTarget).toBeNull();
  });

  it('does nothing when no reveal target is set', async () => {
    getFileTree.mockResolvedValueOnce([file('a.ts', 'a.ts')]);

    // No revealTarget set.
    render(<FileTree port={1} projectId="p1" />);

    await screen.findByTestId('file-tree-row-a.ts');

    // No unexpected behavior; store stays null.
    expect(useFilesStore.getState().revealTarget).toBeNull();
  });
});
