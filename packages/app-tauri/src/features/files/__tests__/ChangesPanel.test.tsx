/**
 * ChangesPanel tests — verify status token mapping.
 *
 * Strategy: mock `@/lib/api/git` to return rows with known git short-codes,
 * then assert the status glyph carries the correct Tailwind text-token class.
 * Hardcoded expected values — no re-implementation of the production statusClass helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ChangesPanel } from '../ChangesPanel';

vi.mock('@/lib/api/git', () => ({
  getGitStatus: vi.fn(),
}));

// We import AFTER the mock so we get the mocked version
import { getGitStatus } from '@/lib/api/git';

const mockGetGitStatus = vi.mocked(getGitStatus);

// Minimal props
const BASE_PROPS = { port: 31415, projectId: 'proj-1' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChangesPanel status tokens', () => {
  it('added file (status A) uses text-mf-diff-add-text', async () => {
    mockGetGitStatus.mockResolvedValue([{ path: 'added.ts', status: 'A' }]);
    render(<ChangesPanel {...BASE_PROPS} />);
    const badge = await screen.findByTestId('changes-status-added.ts');
    expect(badge.className).toContain('text-mf-diff-add-text');
    expect(badge.className).not.toContain('text-mf-diff-add-border');
  });

  it('untracked file (status ??) uses text-mf-diff-add-text', async () => {
    mockGetGitStatus.mockResolvedValue([{ path: 'new.ts', status: '??' }]);
    render(<ChangesPanel {...BASE_PROPS} />);
    const badge = await screen.findByTestId('changes-status-new.ts');
    expect(badge.className).toContain('text-mf-diff-add-text');
  });

  it('modified file (status M) uses text-mf-warning', async () => {
    mockGetGitStatus.mockResolvedValue([{ path: 'modified.ts', status: 'M' }]);
    render(<ChangesPanel {...BASE_PROPS} />);
    const badge = await screen.findByTestId('changes-status-modified.ts');
    expect(badge.className).toContain('text-mf-warning');
    expect(badge.className).not.toContain('text-mf-surface-files');
  });

  it('deleted file (status D) uses text-mf-diff-del-text', async () => {
    mockGetGitStatus.mockResolvedValue([{ path: 'deleted.ts', status: 'D' }]);
    render(<ChangesPanel {...BASE_PROPS} />);
    const badge = await screen.findByTestId('changes-status-deleted.ts');
    expect(badge.className).toContain('text-mf-diff-del-text');
    expect(badge.className).not.toContain('text-destructive');
  });

  it('renders loading state initially and shows files after', async () => {
    let resolve!: (v: { path: string; status: string }[]) => void;
    const promise = new Promise<{ path: string; status: string }[]>((res) => {
      resolve = res;
    });
    mockGetGitStatus.mockReturnValue(promise);
    render(<ChangesPanel {...BASE_PROPS} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    resolve([{ path: 'file.ts', status: 'M' }]);
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    expect(screen.getByTestId('changes-status-file.ts')).toBeInTheDocument();
  });
});
