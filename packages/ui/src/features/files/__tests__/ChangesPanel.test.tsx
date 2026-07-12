/**
 * ChangesPanel tests — verify status token mapping.
 *
 * Strategy: mock `@/lib/api/git` to return rows with known git short-codes,
 * then assert the status glyph carries the correct Tailwind text-token class.
 * Hardcoded expected values — no re-implementation of the production statusClass helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChangesPanel } from '../ChangesPanel';

vi.mock('@/lib/api/git', () => ({
  getGitStatus: vi.fn(),
  getBranchDiffs: vi.fn(),
}));
vi.mock('@/lib/api/files', () => ({
  getSessionFiles: vi.fn(),
}));
// Inert daemon event bus — the live auto-refresh subscription must not fire in tests.
vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: { onEvent: vi.fn(() => () => {}) },
}));

// We import AFTER the mock so we get the mocked version
import { getGitStatus, getBranchDiffs } from '@/lib/api/git';
import { getSessionFiles } from '@/lib/api/files';

const mockGetGitStatus = vi.mocked(getGitStatus);
const mockGetBranchDiffs = vi.mocked(getBranchDiffs);
const mockGetSessionFiles = vi.mocked(getSessionFiles);

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

  it('modified file (status M) uses text-muted-foreground', async () => {
    mockGetGitStatus.mockResolvedValue([{ path: 'modified.ts', status: 'M' }]);
    render(<ChangesPanel {...BASE_PROPS} />);
    const badge = await screen.findByTestId('changes-status-modified.ts');
    expect(badge.className).toContain('text-muted-foreground');
    expect(badge.className).not.toContain('text-mf-warning');
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

describe('ChangesPanel scope modes', () => {
  it('default (Uncommitted) loads git status, not session or branch sources', async () => {
    mockGetGitStatus.mockResolvedValue([{ path: 'a.ts', status: 'M' }]);
    render(<ChangesPanel {...BASE_PROPS} chatId="c1" />);
    await screen.findByTestId('changes-row-a.ts');
    expect(mockGetGitStatus).toHaveBeenCalledWith(31415, 'proj-1', 'c1');
    expect(mockGetSessionFiles).not.toHaveBeenCalled();
    expect(mockGetBranchDiffs).not.toHaveBeenCalled();
  });

  it('Session mode loads session files and shows rows without a status badge', async () => {
    mockGetGitStatus.mockResolvedValue([]);
    mockGetSessionFiles.mockResolvedValue(['src/touched.ts']);
    render(<ChangesPanel {...BASE_PROPS} chatId="c1" />);
    fireEvent.click(screen.getByTestId('changes-mode-session'));
    await screen.findByTestId('changes-row-src/touched.ts');
    expect(mockGetSessionFiles).toHaveBeenCalledWith(31415, 'c1');
    // Session rows carry no per-file git status.
    expect(screen.queryByTestId('changes-status-src/touched.ts')).toBeNull();
  });

  it('Session mode with no active chat shows the empty-session hint', async () => {
    mockGetGitStatus.mockResolvedValue([]);
    render(<ChangesPanel {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('changes-mode-session'));
    expect(await screen.findByText('Open a session to view its changes.')).toBeInTheDocument();
    expect(mockGetSessionFiles).not.toHaveBeenCalled();
  });

  it('Branch mode loads branch diffs and shows the comparison line', async () => {
    mockGetGitStatus.mockResolvedValue([]);
    mockGetBranchDiffs.mockResolvedValue({
      branch: 'feat/x',
      baseBranch: 'main',
      mergeBase: 'abc',
      files: [{ path: 'b.ts', status: 'A' }],
    });
    render(<ChangesPanel {...BASE_PROPS} chatId="c1" />);
    fireEvent.click(screen.getByTestId('changes-mode-branch'));
    await screen.findByTestId('changes-row-b.ts');
    expect(mockGetBranchDiffs).toHaveBeenCalledWith(31415, 'proj-1', 'c1');
    expect(screen.getByText('feat/x ↔ main')).toBeInTheDocument();
  });
});
