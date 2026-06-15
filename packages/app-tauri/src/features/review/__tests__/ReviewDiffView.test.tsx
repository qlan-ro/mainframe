/**
 * ReviewDiffView tests.
 *
 * Behaviors covered:
 *  - On mount with a file, calls getWorkingDiff(port, projectId, file, { chatId }).
 *  - Renders a CmDiffEditor stub with the returned original/modified.
 *  - Submitting an inline comment calls onAppend with a body matching the
 *    parse-review-comment format using a REAL clicked line + its text (not empty).
 *    The mock CmDiffEditor fires its onLineSelect prop to simulate a line click.
 *  - Submit is disabled until a line is selected AND a comment is typed.
 *  - review-comment-selected-line shows the chosen line + a text snippet.
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
// Mock CmDiffEditor — record its props and expose onLineSelect so tests can
// trigger a simulated line click without mounting real CodeMirror.
// ---------------------------------------------------------------------------

type OnLineSelect = (sel: { line: number; text: string }) => void;
const lastDiffEditorProps: Record<string, unknown> = {};
let capturedOnLineSelect: OnLineSelect | undefined;

vi.mock('@/features/editor/CmDiffEditor', () => ({
  CmDiffEditor: (props: Record<string, unknown>) => {
    Object.assign(lastDiffEditorProps, props);
    capturedOnLineSelect = props['onLineSelect'] as OnLineSelect | undefined;
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
  capturedOnLineSelect = undefined;
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

  it('submit is disabled before a line is selected and a comment is typed', async () => {
    mockGetWorkingDiff.mockResolvedValue({ original: 'old', modified: 'new', diff: '', source: 'git' });
    render(<ReviewDiffView port={31415} projectId="proj-1" chatId="chat-1" file="src/a.ts" onAppend={vi.fn()} />);

    await waitFor(() => screen.queryByTestId('cm-diff-editor-stub'));

    const submit = screen.getByTestId('review-comment-submit');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('submit is disabled when a line is selected but no comment is typed', async () => {
    mockGetWorkingDiff.mockResolvedValue({ original: 'old', modified: 'new', diff: '', source: 'git' });
    render(<ReviewDiffView port={31415} projectId="proj-1" chatId="chat-1" file="src/a.ts" onAppend={vi.fn()} />);

    await waitFor(() => screen.queryByTestId('cm-diff-editor-stub'));

    // Simulate a line click in CmDiffEditor
    capturedOnLineSelect?.({ line: 3, text: 'const x = 1;' });

    const submit = screen.getByTestId('review-comment-submit');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the selected line info in review-comment-selected-line after a click', async () => {
    mockGetWorkingDiff.mockResolvedValue({ original: 'old', modified: 'new', diff: '', source: 'git' });
    render(<ReviewDiffView port={31415} projectId="proj-1" chatId="chat-1" file="src/a.ts" onAppend={vi.fn()} />);

    await waitFor(() => screen.queryByTestId('cm-diff-editor-stub'));

    capturedOnLineSelect?.({ line: 3, text: 'const x = 1;' });

    await waitFor(() => {
      const el = screen.getByTestId('review-comment-selected-line');
      expect(el.textContent).toContain('3');
    });
  });

  it('appends a formatted comment with the REAL clicked line and text when submitted', async () => {
    mockGetWorkingDiff.mockResolvedValue({ original: 'old', modified: 'new', diff: '', source: 'git' });
    const onAppend = vi.fn();
    render(<ReviewDiffView port={31415} projectId="proj-1" chatId="chat-1" file="src/a.ts" onAppend={onAppend} />);

    await waitFor(() => screen.queryByTestId('cm-diff-editor-stub'));

    // Simulate clicking line 3 in CmDiffEditor
    capturedOnLineSelect?.({ line: 3, text: 'const x = 1;' });

    const commentInput = screen.getByTestId('review-comment-input');
    await userEvent.type(commentInput, 'looks off');

    await userEvent.click(screen.getByTestId('review-comment-submit'));

    expect(onAppend).toHaveBeenCalledTimes(1);

    const body = onAppend.mock.calls[0]![0] as string;
    // Must match: "Diff of `src/a.ts`\n\nAt line 3:\n```\nconst x = 1;\n```\nlooks off"
    expect(body).toMatch(/^Diff of `src\/a\.ts`\n\nAt line 3:\n```\nconst x = 1;\n```\nlooks off$/);
  });

  it('renders an error when getWorkingDiff rejects', async () => {
    mockGetWorkingDiff.mockRejectedValue(new Error('network error'));
    render(<ReviewDiffView port={31415} projectId="proj-1" chatId="chat-1" file="src/a.ts" onAppend={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load diff/i)).toBeTruthy();
    });
  });
});
