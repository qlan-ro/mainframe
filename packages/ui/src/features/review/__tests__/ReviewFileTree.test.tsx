import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReviewFile } from '../git-status-to-files';

const { ReviewFileTree } = await import('../ReviewFileTree');

const FILES: ReviewFile[] = [
  { path: 'src/a.ts', status: 'modified', additions: 18, deletions: 7 },
  { path: 'src/b.ts', status: 'added', additions: 42, deletions: 0 },
  { path: 'src/c.ts', status: 'deleted', additions: 0, deletions: 96 },
  { path: 'src/d.ts', status: 'renamed', additions: 3, deletions: 3 },
];

describe('ReviewFileTree', () => {
  it('renders a review-file-row-* for each file', () => {
    render(<ReviewFileTree files={FILES} selectedFile={null} onSelectFile={vi.fn()} />);
    for (const f of FILES) {
      expect(screen.queryByTestId(`review-file-row-${f.path}`)).not.toBeNull();
    }
  });

  it('renders a "Changed files" heading', () => {
    render(<ReviewFileTree files={FILES} selectedFile={null} onSelectFile={vi.fn()} />);
    expect(screen.getByText(/Changed files/i)).toBeTruthy();
  });

  it('calls onSelectFile with the path when a row is clicked', async () => {
    const onSelectFile = vi.fn();
    render(<ReviewFileTree files={FILES} selectedFile={null} onSelectFile={onSelectFile} />);
    await userEvent.click(screen.getByTestId('review-file-row-src/a.ts'));
    expect(onSelectFile).toHaveBeenCalledWith('src/a.ts');
  });

  it('renders "No changes to review" when files is empty', () => {
    render(<ReviewFileTree files={[]} selectedFile={null} onSelectFile={vi.fn()} />);
    expect(screen.getByText(/No changes to review/i)).toBeTruthy();
  });

  it('tags the empty state with review-file-tree-empty', () => {
    render(<ReviewFileTree files={[]} selectedFile={null} onSelectFile={vi.fn()} />);
    expect(screen.getByTestId('review-file-tree-empty')).toBeTruthy();
  });

  it('shows a status badge for each file', () => {
    render(<ReviewFileTree files={FILES} selectedFile={null} onSelectFile={vi.fn()} />);
    expect(screen.getByText('M')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('D')).toBeTruthy();
    expect(screen.getByText('R')).toBeTruthy();
  });

  it('renders a stat meter for each file', () => {
    render(<ReviewFileTree files={FILES} selectedFile={null} onSelectFile={vi.fn()} />);
    for (const f of FILES) {
      expect(screen.queryByTestId(`review-file-stat-${f.path}`)).not.toBeNull();
    }
  });

  it('marks the selected row with the brand selection tint (distinct from unselected)', () => {
    render(<ReviewFileTree files={FILES} selectedFile="src/a.ts" onSelectFile={vi.fn()} />);
    const selected = screen.getByTestId('review-file-row-src/a.ts');
    const unselected = screen.getByTestId('review-file-row-src/b.ts');
    expect(selected.className).toContain('bg-mf-selection');
    expect(unselected.className).not.toContain('bg-mf-selection');
  });

  it('strikes through and dims a viewed (non-selected) file', () => {
    render(
      <ReviewFileTree files={FILES} selectedFile={null} onSelectFile={vi.fn()} viewedFiles={new Set(['src/a.ts'])} />,
    );
    const viewedName = screen.getByText('a.ts');
    expect(viewedName.className).toContain('line-through');
    const notViewedName = screen.getByText('b.ts');
    expect(notViewedName.className).not.toContain('line-through');
  });
});
