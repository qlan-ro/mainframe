import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReviewFile } from '../git-status-to-files';

const { ReviewFileTree } = await import('../ReviewFileTree');

const FILES: ReviewFile[] = [
  { path: 'src/a.ts', status: 'modified' },
  { path: 'src/b.ts', status: 'added' },
  { path: 'src/c.ts', status: 'deleted' },
  { path: 'src/d.ts', status: 'renamed' },
];

describe('ReviewFileTree', () => {
  it('renders a review-file-row-* for each file', () => {
    render(<ReviewFileTree files={FILES} selectedFile={null} onSelectFile={vi.fn()} />);
    for (const f of FILES) {
      expect(screen.queryByTestId(`review-file-row-${f.path}`)).not.toBeNull();
    }
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

  it('shows a status badge for each file', () => {
    render(<ReviewFileTree files={FILES} selectedFile={null} onSelectFile={vi.fn()} />);
    // Each status kind renders a visible badge text
    expect(screen.getByText('M')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('D')).toBeTruthy();
    expect(screen.getByText('R')).toBeTruthy();
  });
});
