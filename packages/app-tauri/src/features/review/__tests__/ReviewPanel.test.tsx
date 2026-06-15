/**
 * ReviewPanel tests.
 *
 * Behaviors covered:
 *  - reviewOpen=false → nothing renders.
 *  - reviewOpen=true → review-modal renders + getGitStatus called.
 *  - Selecting a file from the file list renders ReviewDiffView for it.
 *  - The onAppend prop calls runtime.threads.main.append({ role, content }).
 *  - Empty git status renders "No changes to review".
 *  - Close button sets reviewOpen to false.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useOverlaysStore } from '@/store/overlays';

// ---------------------------------------------------------------------------
// Mock getGitStatus (returns a realistic set of changed files)
// ---------------------------------------------------------------------------

const mockGetGitStatus = vi.fn();
vi.mock('@/lib/api/git', () => ({
  getGitStatus: (...args: unknown[]) => mockGetGitStatus(...args),
  // getWorkingDiff is used by ReviewDiffView; mock it to prevent actual calls
  getWorkingDiff: () => Promise.resolve({ original: '', modified: '', diff: '', source: 'git' }),
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
// Mock useAssistantRuntime to capture append calls
// ---------------------------------------------------------------------------

const mockAppend = vi.fn();
vi.mock('@assistant-ui/react', async (orig) => ({
  ...(await orig<typeof import('@assistant-ui/react')>()),
  useAssistantRuntime: () => ({
    threads: {
      main: { append: mockAppend },
    },
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
  it('wires onAppend to runtime.threads.main.append with the correct shape', async () => {
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
});
