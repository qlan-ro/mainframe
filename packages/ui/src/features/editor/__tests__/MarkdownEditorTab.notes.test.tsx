/**
 * MarkdownEditorTab — cross-surface note set (task 20).
 *
 * Exercises the lifted useFileTabNotes model through BOTH surfaces a
 * markdown file tab offers: the rendered Preview blocks (MarkdownAnnotatedBlock)
 * and the real CM6 Source gutter (mirrors use-comment-view-sync.test.tsx's
 * jsdom stubs — Range.getClientRects is unimplemented there and CM6 calls it
 * on mount). CmEditor itself is NOT mocked: the Source-mode assertions need a
 * real gutter to click and a real document to edit.
 *
 * Covers spec AC 1, 2, 4, 6, 13, 14:
 *   1. a note + unsaved draft survives Preview -> Source -> Preview.
 *   2. a view seeds/reflects notes added or removed outside it.
 *   4. submit sends one message covering every mode/surface, ascending by line.
 *   6. no active session: submit is a no-op, every note and draft survives.
 *  13/14. editing the document maps a note's range while its quote stays put,
 *   in both Source's own gutter and Preview's marker/testid.
 */
import { useState } from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MarkdownEditorTab } from '../MarkdownEditorTab';

const zeroRect: DOMRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
};

function zeroRectList(): DOMRectList {
  return {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {
      /* jsdom stub */
    },
  } as unknown as DOMRectList;
}

beforeAll(() => {
  Range.prototype.getClientRects = zeroRectList;
  Range.prototype.getBoundingClientRect = () => zeroRect;
});

vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

const mockSendReview = vi.fn<(filePath: string, items: unknown[]) => Promise<'sent' | 'no-session'>>();

vi.mock('../inline-comments/use-send-review', () => ({
  useSendReview: () => mockSendReview,
}));

const render = (ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: TooltipProvider, ...options });

// Distinct single-line blocks so each has an unambiguous md-note-* testid:
// h1 at line 1, "First paragraph." at line 3, "Second paragraph." at line 5.
const MD = '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n';

/** Controlled harness: lets a test edit the document like a real save/reload would. */
function Harness({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  return (
    <>
      <button data-testid="prepend-two-lines" onClick={() => setValue((v) => `L0\nL0b\n${v}`)}>
        prepend
      </button>
      <MarkdownEditorTab value={value} path="/notes.md" onChange={setValue} />
    </>
  );
}

function toSource() {
  fireEvent.mouseDown(screen.getByTestId('markdown-mode-edit'));
}
function toPreview() {
  fireEvent.mouseDown(screen.getByTestId('markdown-mode-preview'));
}

/** Clicks the CM6 gutter's add-button for a 1-based document line (real gutter, jsdom-clickable regardless of hover-only visual opacity). */
function addNoteInSource(line: number) {
  const buttons = document.querySelectorAll('.cm-comment-gutter-add, .cm-comment-gutter-marker');
  const target = buttons[line - 1];
  if (!target) throw new Error(`no gutter row for line ${line}`);
  fireEvent.click(target);
}

function typeDraft(text: string) {
  fireEvent.change(screen.getByTestId('editor-comment-widget-input'), { target: { value: text } });
}

beforeEach(() => {
  mockSendReview.mockReset();
  mockSendReview.mockResolvedValue('sent');
});

describe('MarkdownEditorTab — cross-surface notes', () => {
  it('a note plus an unsaved draft survives Preview -> Source -> Preview', () => {
    render(<Harness initialValue={MD} />);

    fireEvent.click(screen.getByTestId('md-note-add-3-3'));
    typeDraft('still typing…');

    toSource();
    expect(document.querySelector('.cm-comment-gutter-marker')).toBeTruthy();

    toPreview();
    fireEvent.click(screen.getByTestId('md-note-marker-3-3'));
    expect(screen.getByTestId('editor-comment-widget-input')).toHaveValue('still typing…');
  });

  it('a Preview-created note shows a gutter marker in Source, and a Source-created note shows a Preview marker', () => {
    render(<Harness initialValue={MD} />);

    // Preview -> Source direction.
    fireEvent.click(screen.getByTestId('md-note-add-1-1'));
    toSource();
    expect(document.querySelectorAll('.cm-comment-gutter-marker')).toHaveLength(1);

    // Source -> Preview direction: line 5 ("Second paragraph.") is the 5th gutter row.
    addNoteInSource(5);
    toPreview();
    expect(screen.getByTestId('md-note-marker-1-1')).toBeInTheDocument();
    expect(screen.getByTestId('md-note-marker-5-5')).toBeInTheDocument();
  });

  it('notes created in two modes submit as one message, blocks ascending by start line', async () => {
    render(<Harness initialValue={MD} />);

    // Created LAST but at the LOWEST line — the submit order must not be insertion order.
    fireEvent.click(screen.getByTestId('md-note-add-5-5'));
    typeDraft('preview note');

    toSource();
    addNoteInSource(1);
    typeDraft('source note');

    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-submit-review-btn'));
    });

    expect(mockSendReview).toHaveBeenCalledTimes(1);
    const [, items] = mockSendReview.mock.calls[0]!;
    expect(items).toEqual([
      expect.objectContaining({ startLine: 1, endLine: 1, comment: 'source note' }),
      expect.objectContaining({ startLine: 5, endLine: 5, comment: 'preview note' }),
    ]);
  });

  it('with no active session, submit is a no-op and every note and draft survives', async () => {
    mockSendReview.mockResolvedValue('no-session');
    render(<Harness initialValue={MD} />);

    fireEvent.click(screen.getByTestId('md-note-add-3-3'));
    typeDraft('keep me');

    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-submit-review-btn'));
    });

    expect(mockSendReview).toHaveBeenCalledTimes(1);
    // The note is still present and its draft intact.
    fireEvent.click(screen.getByTestId('md-note-marker-3-3'));
    expect(screen.getByTestId('editor-comment-widget-input')).toHaveValue('keep me');
  });

  it('inserting two lines above a note in Source moves its marker and submitted line, quote unchanged', async () => {
    render(<Harness initialValue={MD} />);

    toSource();
    // Line 3 is "First paragraph." — the 3rd gutter row.
    addNoteInSource(3);
    typeDraft('about this paragraph');

    fireEvent.click(screen.getByTestId('prepend-two-lines'));

    toPreview();
    expect(screen.queryByTestId('md-note-marker-3-3')).toBeNull();
    expect(screen.getByTestId('md-note-marker-5-5')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('md-note-marker-5-5'));
    expect(screen.getByTestId('editor-comment-widget-snippet').textContent).toContain('First paragraph.');

    await act(async () => {
      fireEvent.click(screen.getByTestId('editor-submit-review-btn'));
    });
    const [, items] = mockSendReview.mock.calls[0]!;
    expect(items).toEqual([
      expect.objectContaining({
        startLine: 5,
        endLine: 5,
        lineContent: 'First paragraph.',
        comment: 'about this paragraph',
      }),
    ]);
  });
});
