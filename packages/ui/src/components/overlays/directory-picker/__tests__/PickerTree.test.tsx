/**
 * PickerTree — style-contract tests (area-3 review-fix pass).
 *
 * Pins:
 *  - Unselected row label uses the real `text-muted-foreground` token, never
 *    the phantom `text-mf-text-2` (Tailwind silently drops unknown tokens,
 *    so the phantom class renders with an inherited color — no visible bug
 *    in isolation, hence the pin).
 *  - Chevron icons use the real `text-mf-text-3` token (design T.text3).
 *  - Per-node Empty/Loading rows use 4px vertical padding (py-[4px]) on the
 *    compressed spacing scale, not the 2px `py-1` default.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildTree, FlatTreeView, type FlatTree } from '../PickerTree';
import type { FileTreeEntry } from '@/lib/api/files';

function treeWithExpandedEmptyDir(): FlatTree {
  const entries: FileTreeEntry[] = [{ name: 'proj', path: '/Users/me/proj', type: 'directory' }];
  const tree = buildTree(entries, 0);
  const node = tree.nodes.get('/Users/me/proj')!;
  tree.nodes.set('/Users/me/proj', { ...node, expanded: true, childrenPaths: [] });
  return tree;
}

function treeWithLoadingDir(): FlatTree {
  const entries: FileTreeEntry[] = [{ name: 'proj', path: '/Users/me/proj', type: 'directory' }];
  const tree = buildTree(entries, 0);
  const node = tree.nodes.get('/Users/me/proj')!;
  tree.nodes.set('/Users/me/proj', { ...node, expanded: true, childrenPaths: null });
  return tree;
}

describe('PickerTree — row label token', () => {
  it('uses text-muted-foreground (not the phantom text-mf-text-2) on an unselected row', () => {
    const entries: FileTreeEntry[] = [{ name: 'proj', path: '/Users/me/proj', type: 'directory' }];
    const tree = buildTree(entries, 0);

    render(<FlatTreeView tree={tree} selectedPath={null} onSelect={() => {}} onToggle={() => {}} />);

    const row = screen.getByTestId('directory-picker-row-/Users/me/proj');
    expect(row.className).not.toContain('text-mf-text-2');
    expect(row.className).toContain('text-muted-foreground');
  });
});

describe('PickerTree — chevron token', () => {
  it('renders the collapsed chevron with the real text-mf-text-3 token', () => {
    const entries: FileTreeEntry[] = [{ name: 'proj', path: '/Users/me/proj', type: 'directory' }];
    const tree = buildTree(entries, 0);

    render(<FlatTreeView tree={tree} selectedPath={null} onSelect={() => {}} onToggle={() => {}} />);

    const row = screen.getByTestId('directory-picker-row-/Users/me/proj');
    const chevron = row.querySelector('svg');
    expect(chevron?.getAttribute('class')).toContain('text-mf-text-3');
  });
});

describe('PickerTree — per-node row padding', () => {
  it('renders the Empty row with 4px vertical padding (py-[4px])', () => {
    const tree = treeWithExpandedEmptyDir();

    render(<FlatTreeView tree={tree} selectedPath={null} onSelect={() => {}} onToggle={() => {}} />);

    const empty = screen.getByTestId('directory-picker-node-empty-/Users/me/proj');
    expect(empty.className).toContain('py-[4px]');
    expect(empty.className).not.toContain('py-1');
  });

  it('renders the Loading row with 4px vertical padding (py-[4px])', () => {
    const tree = treeWithLoadingDir();

    render(<FlatTreeView tree={tree} selectedPath={null} onSelect={() => {}} onToggle={() => {}} />);

    const loading = screen.getByTestId('directory-picker-node-loading-/Users/me/proj');
    expect(loading.className).toContain('py-[4px]');
    expect(loading.className).not.toContain('py-1');
  });
});
