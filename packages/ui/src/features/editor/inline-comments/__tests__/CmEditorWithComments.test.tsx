/**
 * CmEditorWithComments — integration tests for submit-review + per-comment send.
 *
 * Mocks:
 *   - useSendReview: spy that captures calls
 *   - CmEditor: renders a minimal placeholder (avoids CM6 DOM complexity) and
 *     exposes a stub EditorView whose state.field(commentField) returns a Map
 *     of fake block widgets (each with a real hostElement + setDestroyCallback)
 *     so the component can portal an InlineCommentWidget into them.
 *   - buildCommentGutter: captures the onOpenComment callback so tests can open
 *     a comment's portal (and thus drive its widget's onSend / onTextChange).
 *   - useInlineComments: returns a controlled set of comments so we can assert
 *     that deleteComment is called per-comment.
 *   - resolveCommentRange / comment-gutter effects: lightweight stubs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockSendReview = vi.fn().mockResolvedValue(undefined);

vi.mock('../use-send-review', () => ({
  useSendReview: () => mockSendReview,
}));

// Fake block widgets keyed by comment id. Each has a real DOM host element so
// createPortal can mount the InlineCommentWidget into it.
interface FakeWidget {
  hostElement: HTMLDivElement;
  setDestroyCallback: (cb: () => void) => void;
}
const fakeWidgets = new Map<string, FakeWidget>();

function makeFakeWidget(): FakeWidget {
  // The host must be attached to document.body so portal content is reachable
  // via Testing Library's screen queries (which scope to document.body).
  const hostElement = document.createElement('div');
  document.body.appendChild(hostElement);
  return {
    hostElement,
    setDestroyCallback: vi.fn(),
  };
}

// Stub CmEditor — exposes a stub view whose commentField.widgets is our Map.
vi.mock('../../CmEditor', () => ({
  CmEditor: ({ onViewReady }: { onViewReady?: (v: unknown) => void }) => {
    React.useEffect(() => {
      onViewReady?.({
        state: { field: () => ({ widgets: fakeWidgets }) },
        dispatch: vi.fn(),
      });
    }, [onViewReady]);
    return <div data-testid="cm-editor-stub" />;
  },
}));

// Capture the gutter's onOpenComment so tests can open a portal on demand.
let capturedOnOpen: ((id: string) => void) | null = null;

vi.mock('../comment-gutter', () => ({
  addCommentEffect: { of: vi.fn() },
  deleteCommentEffect: { of: vi.fn((id: string) => ({ type: 'delete', id })) },
  buildCommentGutter: (cfg: { onOpenComment: (id: string) => void }) => {
    capturedOnOpen = cfg.onOpenComment;
    return [];
  },
  commentField: {},
}));

vi.mock('../resolve-comment-range', () => ({
  resolveCommentRange: () => ({ startLine: 3, endLine: 5, lineContent: 'some code' }),
}));

// Control the comments that useInlineComments returns
const mockDeleteComment = vi.fn();
const mockEditComment = vi.fn();
const mockAddComment = vi.fn().mockReturnValue('new-id');

const testComments = [
  { id: 'c1', startLine: 1, endLine: 1, lineContent: 'line one', text: 'saved text one' },
  { id: 'c2', startLine: 3, endLine: 5, lineContent: 'line three', text: '' },
  { id: 'c3', startLine: 7, endLine: 7, lineContent: 'line seven', text: 'saved text three' },
];

// Frozen baseline so afterEach can always restore testComments after a mutation.
const testCommentsBaseline = testComments.map((c) => ({ ...c }));

vi.mock('../use-inline-comments', () => ({
  useInlineComments: () => ({
    comments: testComments,
    addComment: mockAddComment,
    editComment: mockEditComment,
    deleteComment: mockDeleteComment,
    hasCommentOnLine: () => false,
    getCommentsForLine: () => [],
  }),
}));

// ── Import component under test (after mocks are in place) ───────────────────

import { CmEditorWithComments } from '../CmEditorWithComments';

// ── Helpers ──────────────────────────────────────────────────────────────────

const baseProps = {
  value: '',
  path: 'src/foo.ts',
  language: 'typescript' as const,
  readOnly: false,
  onChange: () => {},
};

/** Open the portal for `id` via the captured gutter callback. */
async function openPortal(id: string) {
  await act(async () => {
    capturedOnOpen?.(id);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendReview.mockResolvedValue(undefined);
  capturedOnOpen = null;
  // Detach any host elements from a previous test.
  for (const w of fakeWidgets.values()) {
    w.hostElement.remove();
  }
  fakeWidgets.clear();
  for (const c of testComments) {
    fakeWidgets.set(c.id, makeFakeWidget());
  }
});

afterEach(() => {
  // Restore the shared testComments array to the baseline so a mid-test throw
  // (e.g. in the empty-review mutation test) cannot poison later tests.
  testComments.length = 0;
  testComments.push(...testCommentsBaseline.map((c) => ({ ...c })));
});

// ── Tests: Submit review ─────────────────────────────────────────────────────

describe('CmEditorWithComments — submit review', () => {
  it('calls sendReview with filePath and non-empty comment items', async () => {
    render(<CmEditorWithComments {...baseProps} filePath="src/foo.ts" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-submit-review-btn'));
    });

    expect(mockSendReview).toHaveBeenCalledTimes(1);
    expect(mockSendReview).toHaveBeenCalledWith('src/foo.ts', [
      { startLine: 1, endLine: 1, lineContent: 'line one', comment: 'saved text one' },
      // c2 has empty text → filtered out
      { startLine: 7, endLine: 7, lineContent: 'line seven', comment: 'saved text three' },
    ]);
  });

  it('clears ALL comments after submit review', async () => {
    render(<CmEditorWithComments {...baseProps} filePath="src/foo.ts" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-submit-review-btn'));
    });

    expect(mockDeleteComment).toHaveBeenCalledWith('c1');
    expect(mockDeleteComment).toHaveBeenCalledWith('c2');
    expect(mockDeleteComment).toHaveBeenCalledWith('c3');
    expect(mockDeleteComment).toHaveBeenCalledTimes(3);
  });

  it('warns and skips send when filePath is not provided', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<CmEditorWithComments {...baseProps} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-submit-review-btn'));
    });

    expect(mockSendReview).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no file path'));

    warnSpy.mockRestore();
  });

  it('sends the DRAFT text (not the saved text) when a comment is edited before submit', async () => {
    render(<CmEditorWithComments {...baseProps} filePath="src/bar.ts" />);

    // Open c1's portal so its InlineCommentWidget renders.
    await openPortal('c1');

    // Drive the draft: type new text into the widget's input. Only c1's portal
    // is open, so there is exactly one widget.
    await act(async () => {
      fireEvent.change(screen.getByTestId('editor-comment-widget-input'), {
        target: { value: 'draft override for c1' },
      });
    });

    // Submit the review.
    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-submit-review-btn'));
    });

    // The c1 item must carry the DRAFT text, not 'saved text one'.
    expect(mockSendReview).toHaveBeenCalledTimes(1);
    expect(mockSendReview).toHaveBeenCalledWith('src/bar.ts', [
      { startLine: 1, endLine: 1, lineContent: 'line one', comment: 'draft override for c1' },
      { startLine: 7, endLine: 7, lineContent: 'line seven', comment: 'saved text three' },
    ]);
  });

  it('does not send an empty review when no comment has text', async () => {
    // Override comments to all-empty for this case via the existing mock array.
    // afterEach restores the baseline so a mid-test throw cannot poison later tests.
    testComments.length = 0;
    testComments.push({ id: 'e1', startLine: 1, endLine: 1, lineContent: 'x', text: '' });
    fakeWidgets.clear();
    fakeWidgets.set('e1', makeFakeWidget());

    render(<CmEditorWithComments {...baseProps} filePath="src/foo.ts" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-submit-review-btn'));
    });

    expect(mockSendReview).not.toHaveBeenCalled();
  });
});

// ── Tests: per-comment Send ──────────────────────────────────────────────────

describe('CmEditorWithComments — per-comment send', () => {
  it('sends ONLY that comment and removes only it', async () => {
    render(<CmEditorWithComments {...baseProps} filePath="src/foo.ts" />);

    // Open c3's portal (it has saved text 'saved text three').
    await openPortal('c3');

    // The widget's Send button fires handleSendOne for c3. Only c3's portal is
    // open, so there is exactly one Send button.
    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-comment-widget-send'));
    });

    // sendReview called once with a single-item review for c3.
    expect(mockSendReview).toHaveBeenCalledTimes(1);
    expect(mockSendReview).toHaveBeenCalledWith('src/foo.ts', [
      { startLine: 7, endLine: 7, lineContent: 'line seven', comment: 'saved text three' },
    ]);

    // Only c3 removed; c1 and c2 remain.
    expect(mockDeleteComment).toHaveBeenCalledTimes(1);
    expect(mockDeleteComment).toHaveBeenCalledWith('c3');
    expect(mockDeleteComment).not.toHaveBeenCalledWith('c1');
    expect(mockDeleteComment).not.toHaveBeenCalledWith('c2');
  });
});
