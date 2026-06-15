import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileTreeEntry } from '@/lib/api/files';

const getFileTree = vi.fn();
const mockEmit = vi.fn();

vi.mock('@/lib/api/files', () => ({ getFileTree: (...a: unknown[]) => getFileTree(...a) }));
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a) }));

// alias for backward compat within this file
const emitSurfaceIntent = mockEmit;

import { FileTree } from '../FileTree';

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
    const menuItem = await screen.findByTestId('file-tree-find-in-path');
    fireEvent.click(menuItem);
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-find-in-path', scopePath: 'src/a.ts', scopeType: 'file' });
  });

  it('emits open-find-in-path for a directory row', async () => {
    getFileTree.mockResolvedValueOnce([dir('src', 'src')]);
    render(<FileTree port={1} projectId="p1" />);
    const row = await screen.findByTestId('file-tree-row-src');
    fireEvent.contextMenu(row);
    const menuItem = await screen.findByTestId('file-tree-find-in-path');
    fireEvent.click(menuItem);
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-find-in-path', scopePath: 'src', scopeType: 'directory' });
  });
});
