/**
 * FileTree "Keep open" context-menu item — split out of FileTree.test.tsx to
 * stay under the 300-line file cap.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FileTreeEntry } from '@/lib/api/files';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import type { RunState, RunTab } from '@/store/run-pane';

const getFileTree = vi.fn();
const mockEmit = vi.fn();

vi.mock('@/lib/api/files', () => ({ getFileTree: (...a: unknown[]) => getFileTree(...a) }));
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a) }));
vi.mock('@/lib/editor/copy-reference', () => ({ writeToClipboard: vi.fn() }));
vi.mock('@/lib/daemon/use-daemon-is-local', () => ({ useDaemonIsLocal: () => true }));

import { FileTree } from '../FileTree';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { useLayoutStore } from '@/store/layout';

beforeEach(() => {
  setHostForTesting(new FakeHostBridge());
});

afterEach(() => {
  resetHostForTesting();
});

const file = (name: string, path: string): FileTreeEntry => ({ name, path, type: 'file' });
const dir = (name: string, path: string): FileTreeEntry => ({ name, path, type: 'directory' });

/** A single-pane run holding one tab, for "is this file already open" scenarios. */
function runWith(tab: RunTab): RunState {
  return { dir: 'v', flex: [1], panes: [{ id: 'p1', active: null, tabs: [tab] }] };
}

describe('FileTree — Keep open menu item', () => {
  beforeEach(() => {
    getFileTree.mockReset();
    mockEmit.mockReset();
    useLayoutStore.setState({ run: null });
    useActiveBasesStore.setState({ bases: {}, scopeKey: null });
  });

  it('offers "Keep open" for a file not yet open, and selecting it opens it as permanent', async () => {
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.contextMenu(await screen.findByTestId('file-tree-row-src/a.ts'));
    const item = await screen.findByTestId('file-tree-keep-open-src/a.ts');
    fireEvent.click(item);
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-file', path: 'src/a.ts', mode: 'permanent' });
  });

  it('hides "Keep open" once the file is already open as permanent', async () => {
    useLayoutStore.setState({
      run: runWith({ id: 't1', kind: 'code', title: 'a.ts', path: 'src/a.ts', mode: 'permanent' }),
    });
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.contextMenu(await screen.findByTestId('file-tree-row-src/a.ts'));
    await screen.findByTestId('file-tree-find-in-file');
    expect(screen.queryByTestId('file-tree-keep-open-src/a.ts')).toBeNull();
  });

  it('still offers "Keep open" for a file open only as a preview', async () => {
    useLayoutStore.setState({
      run: runWith({ id: 't1', kind: 'code', title: 'a.ts', path: 'src/a.ts', mode: 'preview' }),
    });
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.contextMenu(await screen.findByTestId('file-tree-row-src/a.ts'));
    expect(await screen.findByTestId('file-tree-keep-open-src/a.ts')).toBeTruthy();
  });

  it('never offers "Keep open" for a directory', async () => {
    getFileTree.mockResolvedValueOnce([dir('src', 'src')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.contextMenu(await screen.findByTestId('file-tree-row-src'));
    await screen.findByTestId('file-tree-find-in-folder');
    expect(screen.queryByTestId('file-tree-keep-open-src')).toBeNull();
  });

  it('offers "Keep open" when the permanent tab is open under a DIFFERENT scope', async () => {
    useActiveBasesStore.setState({ bases: {}, scopeKey: 'proj:/wt-a' });
    useLayoutStore.setState({
      run: runWith({
        id: 't1',
        kind: 'code',
        title: 'a.ts',
        path: 'src/a.ts',
        mode: 'permanent',
        scopeKey: 'proj:/wt-b',
      }),
    });
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.contextMenu(await screen.findByTestId('file-tree-row-src/a.ts'));
    expect(await screen.findByTestId('file-tree-keep-open-src/a.ts')).toBeTruthy();
  });

  it('offers "Keep open" for a code file when only a permanent DIFF tab is open on the same path', async () => {
    useLayoutStore.setState({
      run: runWith({ id: 't1', kind: 'diff', title: 'a.ts', path: 'src/a.ts', mode: 'permanent' }),
    });
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.contextMenu(await screen.findByTestId('file-tree-row-src/a.ts'));
    expect(await screen.findByTestId('file-tree-keep-open-src/a.ts')).toBeTruthy();
  });

  it('hides "Keep open" when the permanent tab has no `mode` (restored from persistence)', async () => {
    useLayoutStore.setState({
      run: runWith({ id: 't1', kind: 'code', title: 'a.ts', path: 'src/a.ts' }),
    });
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.contextMenu(await screen.findByTestId('file-tree-row-src/a.ts'));
    await screen.findByTestId('file-tree-find-in-file');
    expect(screen.queryByTestId('file-tree-keep-open-src/a.ts')).toBeNull();
  });
});
