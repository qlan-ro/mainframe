/**
 * ReviewDiffView tests.
 *
 * Behaviors covered:
 *  - On mount with a file, calls getWorkingDiff(port, projectId, file, { chatId }).
 *  - Renders a CmDiffEditor stub with the returned original/modified.
 *  - Submitting an inline comment calls onAppend with a string matching the
 *    parse-review-comment format: starts with "Diff of `<file>`\n\nAt line..."
 *  - A getWorkingDiff rejection renders an inline error (no silent catch).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock getWorkingDiff
// ---------------------------------------------------------------------------

const mockGetWorkingDiff = vi.fn();
vi.mock('@/lib/api/git', () => ({
  getWorkingDiff: (...args: unknown[]) => mockGetWorkingDiff(...args),
}));

// ---------------------------------------------------------------------------
// Mock CmDiffEditor — record its props instead of mounting a real CodeMirror
// ---------------------------------------------------------------------------

const lastDiffEditorProps: Record<string, unknown> = {};
vi.mock('@/features/editor/CmDiffEditor', () => ({
  CmDiffEditor: (props: Record<string, unknown>) => {
    Object.assign(lastDiffEditorProps, props);
    return <div data-testid="cm-diff-editor-stub" />;
  },
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
  }),
}));

const { ReviewDiffView } = await import('../ReviewDiffView');

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGetWorkingDiff.mockReset();
  Object.keys(lastDiffEditorProps).forEach((k) => delete lastDiffEditorProps[k]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReviewDiffView', () => {
  it('calls getWorkingDiff on mount with the file and chatId', async () => {
    mockGetWorkingDiff.mockResolvedValue({ original: 'old', modified: 'new', diff: '', source: 'git' });
    render(<ReviewDiffView port={31415} projectId="proj-1" chatId="chat-1" file="src/a.ts" onAppend={vi.fn()} />);

    await waitFor(() => {
      expect(mockGetWorkingDiff).toHaveBeenCalledWith(31415, 'proj-1', 'src/a.ts', { chatId: 'chat-1' });
    });
  });

  it('passes original and modified to CmDiffEditor', async () => {
    mockGetWorkingDiff.mockResolvedValue({
      original: 'const a = 1;',
      modified: 'const a = 2;',
      diff: '',
      source: 'git',
    });
    render(<ReviewDiffView port={31415} projectId="proj-1" chatId="chat-1" file="src/a.ts" onAppend={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByTestId('cm-diff-editor-stub')).not.toBeNull();
    });

    expect(lastDiffEditorProps['original']).toBe('const a = 1;');
    expect(lastDiffEditorProps['modified']).toBe('const a = 2;');
  });

  it('appends a formatted review comment when the form is submitted', async () => {
    mockGetWorkingDiff.mockResolvedValue({ original: 'old', modified: 'new', diff: '', source: 'git' });
    const onAppend = vi.fn();
    render(<ReviewDiffView port={31415} projectId="proj-1" chatId="chat-1" file="src/a.ts" onAppend={onAppend} />);

    await waitFor(() => {
      expect(screen.queryByTestId('review-comment-input')).not.toBeNull();
    });

    // Fill in the comment. The line starts at 1 (default), so we assert
    // "At line 1:" — we don't need to change the line number.
    const commentInput = screen.getByTestId('review-comment-input');
    await userEvent.type(commentInput, 'looks off');

    await userEvent.click(screen.getByTestId('review-comment-submit'));

    // The format satisfies parse-review-comment: "Diff of `<file>`\n\nAt line <N>:..."
    expect(onAppend).toHaveBeenCalledWith(expect.stringMatching(/^Diff of `src\/a\.ts`\n\nAt line \d+:/));
  });

  it('renders an error when getWorkingDiff rejects', async () => {
    mockGetWorkingDiff.mockRejectedValue(new Error('network error'));
    render(<ReviewDiffView port={31415} projectId="proj-1" chatId="chat-1" file="src/a.ts" onAppend={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load diff/i)).toBeTruthy();
    });
  });
});
