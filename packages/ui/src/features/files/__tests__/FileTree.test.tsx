import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileTreeEntry } from '@/lib/api/files';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';

const getFileTree = vi.fn();
const mockEmit = vi.fn();
const mockReveal = vi.fn();
const mockClipboard = vi.fn();
// Controls the useDaemonIsLocal() gate; reset to true (local) before each test.
let daemonIsLocal = true;

vi.mock('@/lib/api/files', () => ({ getFileTree: (...a: unknown[]) => getFileTree(...a) }));
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a) }));
vi.mock('@/lib/editor/copy-reference', () => ({ writeToClipboard: (...a: unknown[]) => mockClipboard(...a) }));
vi.mock('@/lib/daemon/use-daemon-is-local', () => ({ useDaemonIsLocal: () => daemonIsLocal }));

// alias for backward compat within this file
const emitSurfaceIntent = mockEmit;

import { FileTree } from '../FileTree';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { useLayoutStore } from '@/store/layout';

// Set up a FakeHostBridge singleton for all tests in this file.
beforeEach(() => {
  setHostForTesting(new FakeHostBridge());
});

afterEach(() => {
  resetHostForTesting();
});

const dir = (name: string, path: string): FileTreeEntry => ({ name, path, type: 'directory' });
const file = (name: string, path: string): FileTreeEntry => ({ name, path, type: 'file' });

describe('FileTree', () => {
  beforeEach(() => {
    getFileTree.mockReset();
    mockEmit.mockReset();
  });

  it('renders root entries with directories before files', async () => {
    getFileTree.mockResolvedValueOnce([file('z.ts', 'z.ts'), dir('src', 'src')]);
    render(<FileTree port={1} projectId="p1" />);
    await screen.findByTestId('file-tree');
    const rows = screen.getAllByTestId(/^file-tree-row-/);
    expect(rows[0]!.textContent).toContain('src'); // directory first
    expect(rows[1]!.textContent).toContain('z.ts');
  });

  it('clicking a file emits an open-file intent with its path', async () => {
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.click(await screen.findByTestId('file-tree-row-src/a.ts'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file', path: 'src/a.ts' });
  });

  it('double-clicking a file row commits it as a permanent tab', async () => {
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.doubleClick(await screen.findByTestId('file-tree-row-src/a.ts'));
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file', path: 'src/a.ts', mode: 'permanent' });
  });

  it('accelerator-click (Ctrl, non-mac) on a file row opens it as a permanent tab', async () => {
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.click(await screen.findByTestId('file-tree-row-src/a.ts'), { ctrlKey: true });
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file', path: 'src/a.ts', mode: 'permanent' });
    expect(emitSurfaceIntent).toHaveBeenCalledTimes(1);
  });

  it('a bare meta-click (mac accelerator, not the non-mac one) on a file row still previews', async () => {
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.click(await screen.findByTestId('file-tree-row-src/a.ts'), { metaKey: true });
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file', path: 'src/a.ts' });
  });

  it('middle-click (mouseUp button 1) on a file row opens it as a permanent tab', async () => {
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.mouseUp(await screen.findByTestId('file-tree-row-src/a.ts'), { button: 1 });
    expect(emitSurfaceIntent).toHaveBeenCalledWith({ type: 'open-file', path: 'src/a.ts', mode: 'permanent' });
    expect(emitSurfaceIntent).toHaveBeenCalledTimes(1);
  });

  it('a left mouseUp (button 0) on a file row does not emit anything by itself', async () => {
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.mouseUp(await screen.findByTestId('file-tree-row-src/a.ts'), { button: 0 });
    expect(emitSurfaceIntent).not.toHaveBeenCalled();
  });

  it('expanding a directory lazily loads and renders its children', async () => {
    getFileTree.mockResolvedValueOnce([dir('src', 'src')]); // root
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]); // src children
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.click(await screen.findByTestId('file-tree-row-src'));
    await waitFor(() => expect(screen.getByTestId('file-tree-row-src/a.ts')).toBeTruthy());
    expect(getFileTree).toHaveBeenNthCalledWith(2, 1, 'p1', 'src', undefined);
  });

  it('tags each row with data-kind="file" or "directory" without changing the testid', async () => {
    getFileTree.mockResolvedValueOnce([file('z.ts', 'z.ts'), dir('src', 'src')]);
    render(<FileTree port={1} projectId="p1" />);
    await screen.findByTestId('file-tree');
    expect(screen.getByTestId('file-tree-row-z.ts')).toHaveAttribute('data-kind', 'file');
    expect(screen.getByTestId('file-tree-row-src')).toHaveAttribute('data-kind', 'directory');
  });
});

describe('FileTree — context menu', () => {
  beforeEach(() => {
    getFileTree.mockReset();
    mockEmit.mockReset();
  });

  it('emits open-find-in-path for a file row', async () => {
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    const row = await screen.findByTestId('file-tree-row-src/a.ts');
    fireEvent.contextMenu(row);
    const menuItem = await screen.findByTestId('file-tree-find-in-file');
    fireEvent.click(menuItem);
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-find-in-path', scopePath: 'src/a.ts', scopeType: 'file' });
  });

  it('emits open-find-in-path for a directory row', async () => {
    getFileTree.mockResolvedValueOnce([dir('src', 'src')]);
    render(<FileTree port={1} projectId="p1" />);
    const row = await screen.findByTestId('file-tree-row-src');
    fireEvent.contextMenu(row);
    const menuItem = await screen.findByTestId('file-tree-find-in-folder');
    fireEvent.click(menuItem);
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-find-in-path', scopePath: 'src', scopeType: 'directory' });
  });
});

describe('FileTree — context menu copy/reveal actions', () => {
  beforeEach(() => {
    getFileTree.mockReset();
    mockEmit.mockReset();
    mockReveal.mockReset();
    mockClipboard.mockReset();
    daemonIsLocal = true;
    // Active workspace base → absolute paths are base + '/' + relative.
    useActiveBasesStore.setState({ bases: { worktreePath: '/wt' } });
    // Wire showItemInFolder to mockReveal via the host singleton.
    const fakeHost = new FakeHostBridge();
    fakeHost.fs.showItemInFolder = (...a: Parameters<typeof fakeHost.fs.showItemInFolder>) => mockReveal(...a);
    setHostForTesting(fakeHost);
  });

  it('Copy Path writes the absolute on-disk path', async () => {
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.contextMenu(await screen.findByTestId('file-tree-row-src/a.ts'));
    fireEvent.click(await screen.findByTestId('file-tree-copy-path'));
    expect(mockClipboard).toHaveBeenCalledWith('/wt/src/a.ts');
  });

  it('Copy Relative Path writes the repo-relative path', async () => {
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.contextMenu(await screen.findByTestId('file-tree-row-src/a.ts'));
    fireEvent.click(await screen.findByTestId('file-tree-copy-relative-path'));
    expect(mockClipboard).toHaveBeenCalledWith('src/a.ts');
  });

  it('Reveal in Finder reveals the absolute path when the daemon is local', async () => {
    getFileTree.mockResolvedValueOnce([dir('src', 'src')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.contextMenu(await screen.findByTestId('file-tree-row-src'));
    fireEvent.click(await screen.findByTestId('file-tree-reveal'));
    expect(mockReveal).toHaveBeenCalledWith('/wt/src');
  });

  it('disables Reveal in Finder when connected to a remote daemon', async () => {
    daemonIsLocal = false;
    getFileTree.mockResolvedValueOnce([dir('src', 'src')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.contextMenu(await screen.findByTestId('file-tree-row-src'));
    const reveal = await screen.findByTestId('file-tree-reveal');
    expect(reveal).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(reveal);
    expect(mockReveal).not.toHaveBeenCalled();
  });
});

describe('FileTree — Keep open menu item', () => {
  beforeEach(() => {
    getFileTree.mockReset();
    mockEmit.mockReset();
    useLayoutStore.setState({ run: null });
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
      run: {
        dir: 'v',
        flex: [1],
        panes: [
          {
            id: 'p1',
            active: null,
            tabs: [{ id: 't1', kind: 'code', title: 'a.ts', path: 'src/a.ts', mode: 'permanent' }],
          },
        ],
      },
    });
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.contextMenu(await screen.findByTestId('file-tree-row-src/a.ts'));
    await screen.findByTestId('file-tree-find-in-file');
    expect(screen.queryByTestId('file-tree-keep-open-src/a.ts')).toBeNull();
  });

  it('still offers "Keep open" for a file open only as a preview', async () => {
    useLayoutStore.setState({
      run: {
        dir: 'v',
        flex: [1],
        panes: [
          {
            id: 'p1',
            active: null,
            tabs: [{ id: 't1', kind: 'code', title: 'a.ts', path: 'src/a.ts', mode: 'preview' }],
          },
        ],
      },
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
});
