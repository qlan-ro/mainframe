/**
 * PickerTree — style-contract tests (area-3 review-fix pass).
 *
 * Pins:
 *  - Unselected row label uses the real `text-muted-foreground` token, never
 *    the phantom `text-mf-text-2` (Tailwind silently drops unknown tokens,
 *    so the phantom class renders with an inherited color — no visible bug
 *    in isolation, hence the pin).
 *  - Chevron icons use the real `text-mf-text-3` token (design T.text3).
 *
 * Empty/Loading node-row rendering is covered behaviorally in
 * DirectoryPickerModal.test.tsx.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildTree, FlatTreeView } from '../PickerTree';
import type { FileTreeEntry } from '@/lib/api/files';

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
