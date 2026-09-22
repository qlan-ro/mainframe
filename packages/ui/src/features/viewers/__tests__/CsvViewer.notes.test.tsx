/**
 * CsvViewer — row-granular agent notes (spec AC 15-21).
 *
 * CmEditorWithComments is mocked (same convention as SvgViewer.test.tsx) so
 * Source-mode assertions cover the injected model without re-exercising the
 * CM6 gutter/portal machinery those components already test themselves.
 * chat-controller-registry is mocked to assert the real submitted message
 * (mirrors use-send-review.test.ts) rather than stubbing useSendReview, so
 * these tests exercise the actual useReviewActions -> useSendReview wiring.
 *
 * Behaviors covered:
 *  1. Hovering a row and activating its add control creates a note recording
 *     the row's source range and quoting its raw source line.
 *  2. A row whose quoted field spans a newline records the full multi-line
 *     range and quotes both raw lines; the same note's marker shows on those
 *     lines when Source is opened.
 *  3. A filter that hides a noted row keeps it in the submit bar's count and
 *     in the submitted message, and closes its open card.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CsvViewer } from '../CsvViewer';
import type { CmEditorWithComments as CmEditorWithCommentsType } from '@/features/editor/inline-comments/CmEditorWithComments';

const render = (ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: TooltipProvider, ...options });

vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

const mockChatId = 'chat-abc';
const mockActiveIdentity = { chatId: mockChatId as string | undefined, projectId: 'proj-1', projectName: 'Test' };

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => mockActiveIdentity,
}));

const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockGetOrCreate = vi.fn().mockReturnValue({ sendMessage: mockSendMessage });
vi.mock('@/features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: {
    getOrCreate: (...args: unknown[]) => mockGetOrCreate(...args),
  },
}));

type CmEditorWithCommentsProps = ComponentProps<typeof CmEditorWithCommentsType>;
const capturedCmEditorProps: CmEditorWithCommentsProps[] = [];

vi.mock('@/features/editor/inline-comments/CmEditorWithComments', () => ({
  CmEditorWithComments: (props: CmEditorWithCommentsProps) => {
    capturedCmEditorProps.push(props);
    return <div data-testid="mock-cm-editor-with-comments" />;
  },
}));

beforeEach(() => {
  capturedCmEditorProps.length = 0;
  mockActiveIdentity.chatId = mockChatId;
  vi.clearAllMocks();
  mockGetOrCreate.mockReturnValue({ sendMessage: mockSendMessage });
});

function addNoteOnRow(startLine: number, text: string) {
  fireEvent.click(screen.getByTestId(`csv-note-add-${startLine}`));
  fireEvent.change(screen.getByTestId('editor-comment-widget-input'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('editor-comment-widget-save'));
}

/** Creates a note and leaves its card open with an unsaved draft (never calls save/close). */
function openDraftOnRow(startLine: number, text: string) {
  fireEvent.click(screen.getByTestId(`csv-note-add-${startLine}`));
  fireEvent.change(screen.getByTestId('editor-comment-widget-input'), { target: { value: text } });
}

describe('CsvViewer — row notes', () => {
  it('records the row source range and quotes its raw line when a note is added', () => {
    const csv = 'a,b\n1,2\n3,4';
    render(<CsvViewer content={csv} path="/data/rows.csv" />);

    // 'a,b' is line 1 (header), '1,2' is line 2, '3,4' is line 3.
    addNoteOnRow(3, 'check this row');

    fireEvent.mouseDown(screen.getByTestId('viewer-csv-source-toggle'));
    const model = capturedCmEditorProps[capturedCmEditorProps.length - 1]!.model!;
    expect(model.notes).toHaveLength(1);
    expect(model.notes[0]).toMatchObject({ startLine: 3, endLine: 3, lineContent: '3,4', text: 'check this row' });
  });

  it('spans a quoted multi-line field and the note marker shows on those lines in Source', () => {
    const csv = 'a,b\n1,2\n"x\ny",z\n5,6';
    render(<CsvViewer content={csv} path="/data/multiline.csv" />);

    // Row '"x\ny",z' starts at line 3 (ends at line 4) — testid keys on startLine.
    addNoteOnRow(3, 'spans two lines');

    fireEvent.mouseDown(screen.getByTestId('viewer-csv-source-toggle'));
    const model = capturedCmEditorProps[capturedCmEditorProps.length - 1]!.model!;
    expect(model.notes[0]).toMatchObject({ startLine: 3, endLine: 4, lineContent: '"x\ny",z' });
  });

  it('keeps a filtered-out noted row in the submit count and message, and closes its open card', async () => {
    const csv = 'name,note\nAlice,keep\nBob,hide';
    render(<CsvViewer content={csv} path="/data/filtered.csv" />);

    // Bob is line 3.
    openDraftOnRow(3, 'flag this one');
    expect(screen.getByTestId('editor-comment-widget')).toBeInTheDocument();
    expect(screen.getByTestId('editor-submit-review').textContent).toContain('1 of 1');

    fireEvent.change(screen.getByTestId('viewer-csv-filter'), { target: { value: 'Alice' } });

    // Bob's row (and its open card) is no longer rendered, but the note itself survives.
    expect(screen.queryByTestId('csv-note-marker-3')).toBeNull();
    expect(screen.queryByTestId('editor-comment-widget')).toBeNull();
    expect(screen.getByTestId('editor-submit-review').textContent).toContain('1 of 1');

    fireEvent.click(screen.getByTestId('editor-submit-review-btn'));
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: expect.stringContaining('flag this one') }),
        ]),
      }),
    );
  });
});
