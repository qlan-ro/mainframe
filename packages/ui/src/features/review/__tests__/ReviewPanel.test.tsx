/**
 * ReviewPanel tests.
 *
 * Behaviors covered:
 *  - reviewOpen=false → nothing renders.
 *  - reviewOpen=true → review-modal renders + getGitStatus called.
 *  - Selecting a file from the file list renders ReviewDiffView for it.
 *  - The onAppend prop calls aui.threads().thread('main').append({ role, content }).
 *  - Empty git status renders "No changes to review".
 *  - Close button sets reviewOpen to false.
 *  - The change-scope switcher: default scope, per-scope data source, the branch
 *    comparison line, and the omitted +/− totals. These three scope cases came
 *    from the retired inspector `ChangesPanel`, the only surface that used to
 *    offer the scopes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useOverlaysStore } from '@/store/overlays';

// ---------------------------------------------------------------------------
// Mock getGitStatus (returns a realistic set of changed files)
// ---------------------------------------------------------------------------

const mockGetGitStatus = vi.fn();
const mockGetWorkingStat = vi.fn();
const mockGetBranchDiffs = vi.fn();
const mockGetSessionFiles = vi.fn();
const mockGitCommit = vi.fn();
vi.mock('@/lib/api/git', () => ({
  getGitStatus: (...args: unknown[]) => mockGetGitStatus(...args),
  getWorkingStat: (...args: unknown[]) => mockGetWorkingStat(...args),
  getBranchDiffs: (...args: unknown[]) => mockGetBranchDiffs(...args),
  getGitBranch: () => Promise.resolve({ branch: 'feat/rail-collapse' }),
  gitCommit: (...args: unknown[]) => mockGitCommit(...args),
  // getWorkingDiff is used by ReviewDiffView; mock it to prevent actual calls
  getWorkingDiff: () => Promise.resolve({ original: '', modified: '', diff: '', source: 'git' }),
}));

vi.mock('@/lib/api/files', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/files')>()),
  getSessionFiles: (...args: unknown[]) => mockGetSessionFiles(...args),
}));

// ---------------------------------------------------------------------------
// Mock CmDiffEditor so we don't mount CodeMirror in tests. Capture onLineSelect
// so tests can simulate a gutter line click (submit is gated on a selection).
// ---------------------------------------------------------------------------

let capturedOnLineSelect: ((sel: { line: number; text: string }) => void) | undefined;
vi.mock('@/features/editor/CmDiffEditor', () => ({
  CmDiffEditor: (props: { onLineSelect?: (sel: { line: number; text: string }) => void }) => {
    capturedOnLineSelect = props.onLineSelect;
    return <div data-testid="cm-diff-editor-stub" />;
  },
}));

// ---------------------------------------------------------------------------
// Mock the aui client to capture append calls
// ---------------------------------------------------------------------------

const mockAppend = vi.fn();
vi.mock('@assistant-ui/react', async (orig) => ({
  ...(await orig<typeof import('@assistant-ui/react')>()),
  useAui: () => ({
    threads: () => ({ thread: () => ({ append: mockAppend }) }),
  }),
}));

// ---------------------------------------------------------------------------
// Mock daemon port + identity
// ---------------------------------------------------------------------------

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({
    projectId: 'proj-1',
    chatId: 'chat-1',
    projectName: 'Test Project',
    worktreePath: '/Users/me/proj/.worktrees/feat-wt',
  }),
}));

const { ReviewPanel } = await import('../ReviewPanel');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openReview() {
  act(() => {
    useOverlaysStore.getState().setReviewOpen(true);
  });
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGetGitStatus.mockReset();
  mockGetWorkingStat.mockReset();
  mockGetWorkingStat.mockResolvedValue({ files: [], totalAdditions: 0, totalDeletions: 0 });
  mockGetBranchDiffs.mockReset();
  mockGetSessionFiles.mockReset();
  mockGitCommit.mockReset();
  mockGitCommit.mockResolvedValue({ commit: 'abc123' });
  mockAppend.mockReset();
  act(() => {
    useOverlaysStore.setState({ reviewOpen: false, paletteOpen: false, findInPath: null });
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReviewPanel — closed', () => {
  it('does not render review-modal when reviewOpen is false', () => {
    render(<ReviewPanel />);
    expect(screen.queryByTestId('review-modal')).toBeNull();
  });
});

describe('ReviewPanel — open', () => {
  it('renders review-modal and calls getGitStatus when reviewOpen is true', async () => {
    mockGetGitStatus.mockResolvedValue([
      { path: 'src/a.ts', status: 'M' },
      { path: 'src/b.ts', status: 'A' },
    ]);

    render(<ReviewPanel />);
    openReview();

    await waitFor(() => {
      expect(screen.queryByTestId('review-modal')).not.toBeNull();
    });

    expect(mockGetGitStatus).toHaveBeenCalledWith(31415, 'proj-1', 'chat-1');
    // File rows appear
    await waitFor(() => {
      expect(screen.queryByTestId('review-file-row-src/a.ts')).not.toBeNull();
    });
  });

  it('renders "No changes to review" when git status is empty', async () => {
    mockGetGitStatus.mockResolvedValue([]);

    render(<ReviewPanel />);
    openReview();

    await waitFor(() => {
      expect(screen.queryByTestId('review-modal')).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByText(/No changes to review/i)).toBeTruthy();
    });
  });
});

describe('ReviewPanel — append call shape', () => {
  it("wires onAppend to aui.threads().thread('main').append with the correct shape", async () => {
    mockGetGitStatus.mockResolvedValue([{ path: 'src/a.ts', status: 'M' }]);

    render(<ReviewPanel />);
    openReview();

    await waitFor(() => {
      expect(screen.queryByTestId('review-file-row-src/a.ts')).not.toBeNull();
    });

    // Click the file to open diff view
    await userEvent.click(screen.getByTestId('review-file-row-src/a.ts'));

    await waitFor(() => {
      expect(screen.queryByTestId('review-comment-input')).not.toBeNull();
    });

    // Select a line (gutter click) — submit is gated on a real selection
    act(() => {
      capturedOnLineSelect?.({ line: 3, text: 'const x = 1;' });
    });

    // Type a comment and submit
    await userEvent.type(screen.getByTestId('review-comment-input'), 'looks correct');
    await userEvent.click(screen.getByTestId('review-comment-submit'));

    expect(mockAppend).toHaveBeenCalledWith({
      role: 'user',
      content: [{ type: 'text', text: expect.stringContaining('Diff of') }],
    });
  });
});

describe('ReviewPanel — close', () => {
  it('sets reviewOpen to false when the close button is clicked', async () => {
    mockGetGitStatus.mockResolvedValue([]);

    render(<ReviewPanel />);
    openReview();

    await waitFor(() => {
      expect(screen.queryByTestId('review-modal')).not.toBeNull();
    });

    await userEvent.click(screen.getByTestId('review-close'));

    await waitFor(() => {
      expect(useOverlaysStore.getState().reviewOpen).toBe(false);
    });
  });

  it('renders exactly one close control (no duplicate Dialog built-in close)', async () => {
    mockGetGitStatus.mockResolvedValue([]);

    render(<ReviewPanel />);
    openReview();

    await waitFor(() => {
      expect(screen.queryByTestId('review-modal')).not.toBeNull();
    });

    // Only the header's "Close review" button should exist — not the shadcn
    // DialogContent built-in "Close" X (the panel owns its own close).
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    expect(closeButtons).toHaveLength(1);
    expect(screen.getByTestId('review-close')).toBeInTheDocument();
  });
});

describe('ReviewPanel — commit rail', () => {
  it('commits with the typed message and shows the committed state', async () => {
    mockGetGitStatus.mockResolvedValue([{ path: 'src/a.ts', status: 'M' }]);
    mockGetWorkingStat.mockResolvedValue({
      files: [{ path: 'src/a.ts', additions: 4, deletions: 1 }],
      totalAdditions: 4,
      totalDeletions: 1,
    });

    render(<ReviewPanel />);
    openReview();

    await waitFor(() => {
      expect(screen.queryByTestId('review-commit-input')).not.toBeNull();
    });

    await userEvent.type(screen.getByTestId('review-commit-input'), 'feat: do the thing');
    await userEvent.click(screen.getByTestId('review-commit-submit'));

    await waitFor(() => {
      expect(mockGitCommit).toHaveBeenCalledWith(31415, 'proj-1', 'feat: do the thing', 'chat-1');
    });
    await waitFor(() => {
      expect(screen.getByText(/Changes committed/i)).toBeTruthy();
    });
  });

  it('keeps the commit button disabled until a message is typed', async () => {
    mockGetGitStatus.mockResolvedValue([{ path: 'src/a.ts', status: 'M' }]);

    render(<ReviewPanel />);
    openReview();

    await waitFor(() => {
      expect(screen.queryByTestId('review-commit-submit')).not.toBeNull();
    });

    expect(screen.getByTestId('review-commit-submit')).toBeDisabled();
    await userEvent.type(screen.getByTestId('review-commit-input'), 'fix: x');
    expect(screen.getByTestId('review-commit-submit')).not.toBeDisabled();
  });
});

describe('ReviewPanel — change-scope switcher', () => {
  // Radix TabsTrigger activates on mouse-down, not click.
  function chooseScope(scope: 'session' | 'uncommitted' | 'branch') {
    fireEvent.mouseDown(screen.getByTestId(`review-scope-${scope}`));
  }

  it('opens on the Uncommitted scope and reads only the working tree', async () => {
    mockGetGitStatus.mockResolvedValue([{ path: 'src/a.ts', status: 'M' }]);

    render(<ReviewPanel />);
    openReview();

    await waitFor(() => {
      expect(screen.queryByTestId('review-file-row-src/a.ts')).not.toBeNull();
    });

    expect(screen.getByTestId('review-scope-uncommitted')).toHaveAttribute('aria-selected', 'true');
    expect(mockGetGitStatus).toHaveBeenCalledWith(31415, 'proj-1', 'chat-1');
    expect(mockGetSessionFiles).not.toHaveBeenCalled();
    expect(mockGetBranchDiffs).not.toHaveBeenCalled();
  });

  it('Session reads the session files and renders rows with no status badge', async () => {
    mockGetGitStatus.mockResolvedValue([]);
    mockGetSessionFiles.mockResolvedValue(['src/touched.ts']);

    render(<ReviewPanel />);
    openReview();
    await waitFor(() => expect(screen.queryByTestId('review-modal')).not.toBeNull());

    chooseScope('session');

    await waitFor(() => {
      expect(screen.queryByTestId('review-file-row-src/touched.ts')).not.toBeNull();
    });
    expect(mockGetSessionFiles).toHaveBeenCalledWith(31415, 'chat-1');
    // The daemon reports paths only for this scope — no per-file git status.
    expect(screen.queryByTestId('review-file-status-src/touched.ts')).toBeNull();
  });

  it('Branch reads the branch diff and renders the comparison line', async () => {
    mockGetGitStatus.mockResolvedValue([]);
    mockGetBranchDiffs.mockResolvedValue({
      branch: 'feat/x',
      baseBranch: 'main',
      mergeBase: 'abc1234def',
      files: [{ path: 'src/b.ts', status: 'A' }],
    });

    render(<ReviewPanel />);
    openReview();
    await waitFor(() => expect(screen.queryByTestId('review-modal')).not.toBeNull());

    chooseScope('branch');

    await waitFor(() => {
      expect(screen.queryByTestId('review-file-row-src/b.ts')).not.toBeNull();
    });
    expect(mockGetBranchDiffs).toHaveBeenCalledWith(31415, 'proj-1', 'chat-1');
    expect(screen.getByTestId('review-scope-compare-line').textContent).toBe('feat/x ↔ main · abc1234');
    // Branch rows do carry a status, so the badge stays.
    expect(screen.queryByTestId('review-file-status-src/b.ts')).not.toBeNull();
  });

  it('omits the +/− totals on session and branch rather than showing zeros', async () => {
    mockGetGitStatus.mockResolvedValue([{ path: 'src/a.ts', status: 'M' }]);
    mockGetWorkingStat.mockResolvedValue({
      files: [{ path: 'src/a.ts', additions: 4, deletions: 1 }],
      totalAdditions: 4,
      totalDeletions: 1,
    });
    mockGetSessionFiles.mockResolvedValue(['src/touched.ts']);

    render(<ReviewPanel />);
    openReview();

    await waitFor(() => {
      expect(screen.getByTestId('review-file-counts').textContent).toBe('1 file · +4 −1');
    });

    chooseScope('session');

    await waitFor(() => {
      expect(screen.getByTestId('review-file-counts').textContent).toBe('1 file');
    });
  });

  it('resets to Uncommitted on the next open — the scope is never persisted', async () => {
    mockGetGitStatus.mockResolvedValue([]);
    mockGetBranchDiffs.mockResolvedValue({ branch: 'feat/x', baseBranch: 'main', mergeBase: null, files: [] });

    render(<ReviewPanel />);
    openReview();
    await waitFor(() => expect(screen.queryByTestId('review-modal')).not.toBeNull());

    chooseScope('branch');
    await waitFor(() => {
      expect(screen.getByTestId('review-scope-branch')).toHaveAttribute('aria-selected', 'true');
    });

    act(() => useOverlaysStore.getState().setReviewOpen(false));
    openReview();

    await waitFor(() => {
      expect(screen.getByTestId('review-scope-uncommitted')).toHaveAttribute('aria-selected', 'true');
    });
  });
});

describe('ReviewPanel — viewed counter', () => {
  it('updates the header viewed count when a file is marked viewed in the toolbar', async () => {
    mockGetGitStatus.mockResolvedValue([{ path: 'src/a.ts', status: 'M' }]);

    render(<ReviewPanel />);
    openReview();

    await waitFor(() => {
      expect(screen.queryByTestId('review-file-row-src/a.ts')).not.toBeNull();
    });
    expect(screen.getByText('0/1 viewed')).toBeTruthy();

    await userEvent.click(screen.getByTestId('review-file-row-src/a.ts'));
    await waitFor(() => {
      expect(screen.queryByTestId('review-viewed-toggle')).not.toBeNull();
    });
    await userEvent.click(screen.getByTestId('review-viewed-toggle'));

    await waitFor(() => {
      expect(screen.getByText('1/1 viewed')).toBeTruthy();
    });
  });
});
