import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileTreeEntry } from '@/lib/api/files';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';
import { FakeHostBridge } from '@/lib/host/fake-adapter';

const getFileTree = vi.fn();
const mockEmit = vi.fn();
const mockReveal = vi.fn();
const mockClipboard = vi.fn();

vi.mock('@/lib/api/files', () => ({ getFileTree: (...a: unknown[]) => getFileTree(...a) }));
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a) }));
vi.mock('@/lib/editor/copy-reference', () => ({ writeToClipboard: (...a: unknown[]) => mockClipboard(...a) }));

// alias for backward compat within this file
const emitSurfaceIntent = mockEmit;

import { FileTree } from '../FileTree';
import { useActiveBasesStore } from '@/store/active-bases-store';

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

  it('expanding a directory lazily loads and renders its children', async () => {
    getFileTree.mockResolvedValueOnce([dir('src', 'src')]); // root
    getFileTree.mockResolvedValueOnce([file('a.ts', 'src/a.ts')]); // src children
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.click(await screen.findByTestId('file-tree-row-src'));
    await waitFor(() => expect(screen.getByTestId('file-tree-row-src/a.ts')).toBeTruthy());
    expect(getFileTree).toHaveBeenNthCalledWith(2, 1, 'p1', 'src', undefined);
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

  it('Reveal in Finder reveals the absolute path', async () => {
    getFileTree.mockResolvedValueOnce([dir('src', 'src')]);
    render(<FileTree port={1} projectId="p1" />);
    fireEvent.contextMenu(await screen.findByTestId('file-tree-row-src'));
    fireEvent.click(await screen.findByTestId('file-tree-reveal'));
    expect(mockReveal).toHaveBeenCalledWith('/wt/src');
  });
});
