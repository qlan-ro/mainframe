/**
 * SvgViewer tests.
 *
 * Strategy: pass raw SVG text. The viewer renders it via an object URL
 * (URL.createObjectURL stub below) so we avoid dangerouslySetInnerHTML.
 * CmEditorWithComments is mocked (same convention as EditorTab.test.tsx) so
 * Source-mode assertions cover SvgViewer's own wiring — the injected model,
 * read-only html-language props, and the shared NotesSubmitBar — without
 * re-exercising the CM6 gutter/portal machinery those components already
 * test themselves.
 *
 * Behaviors covered:
 *  1. Renders with data-testid="viewer-svg".
 *  2. Renders an <img> (or <object>) tag pointing at the object URL.
 *  3. Shows a loading placeholder when content is null.
 *  4. Preview/Source toggle switches views.
 *  5. Renders inside ViewerShell (viewer-shell present).
 *  6. Footer status (viewer-shell-status) contains SVG metadata.
 *  7. Active toggle is the raised bg-background segment (not bg-accent).
 *  8. Source mode mounts a read-only comment-gutter editor over the raw
 *     markup with the file tab's injected note model (spec AC 22).
 *  9. Toggle segments read "Preview" / "Source" (spec AC 23).
 * 10. Preview exposes no add-note control; a note plus its draft survives a
 *     Preview → Source → Preview round trip (spec AC 24).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SvgViewer } from '../SvgViewer';
import type { CmEditorWithComments as CmEditorWithCommentsType } from '@/features/editor/inline-comments/CmEditorWithComments';

/** Every viewer/preview surface here renders v2 `Hint`s, which need the v2 TooltipProvider. */
const render = (ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: TooltipProvider, ...options });

const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

// jsdom does not implement URL.createObjectURL; stub it.
beforeAll(() => {
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:mock-svg-url'),
    revokeObjectURL: vi.fn(),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// Mock surface-intents so ViewerShell's reveal button doesn't crash.
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

// useFileTabNotes -> useReviewActions -> useSendReview reads these contexts
// directly; neither provider is mounted here, so both need a stub (fact 13 /
// the plan's Risks section — same harness group 6's CsvViewer suite needs).
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: undefined, chatId: undefined, projectPath: undefined }),
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
});

describe('SvgViewer', () => {
  it('renders with data-testid="viewer-svg"', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    expect(screen.getByTestId('viewer-svg')).toBeInTheDocument();
  });

  it('shows a loading placeholder when content is null', () => {
    render(<SvgViewer content={null} path="/a/b/icon.svg" />);
    const root = screen.getByTestId('viewer-svg');
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toBeTruthy();
  });

  it('renders an img element in Preview mode', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    const root = screen.getByTestId('viewer-svg');
    // In preview mode the viewer renders an <img> with the object URL
    const img = root.querySelector('img');
    expect(img).not.toBeNull();
  });

  it('the toggle segments read "Preview" and "Source"', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    expect(screen.getByTestId('viewer-svg-preview-toggle').textContent).toBe('Preview');
    expect(screen.getByTestId('viewer-svg-source-toggle').textContent).toBe('Source');
  });

  it('switches to Source view on Source toggle click', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    const sourceBtn = screen.getByTestId('viewer-svg-source-toggle');
    fireEvent.mouseDown(sourceBtn);
    expect(screen.getByTestId('viewer-svg-source')).toBeInTheDocument();
  });

  it('switches back to preview on Preview toggle click', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    const sourceBtn = screen.getByTestId('viewer-svg-source-toggle');
    fireEvent.mouseDown(sourceBtn);
    const previewBtn = screen.getByTestId('viewer-svg-preview-toggle');
    fireEvent.mouseDown(previewBtn);
    // Back in preview mode — img is visible again
    const root = screen.getByTestId('viewer-svg');
    expect(root.querySelector('img')).not.toBeNull();
  });

  it('renders inside ViewerShell (viewer-shell present)', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    expect(screen.getByTestId('viewer-shell')).toBeInTheDocument();
  });

  it('shows SVG status in the viewer-shell-status footer', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    const status = screen.getByTestId('viewer-shell-status');
    expect(status.textContent).toMatch(/SVG/);
  });

  it('statusRight slot shows dimensions and size when SVG metadata is available', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    const shell = screen.getByTestId('viewer-shell');
    const footer = shell.lastElementChild as HTMLElement;
    // SAMPLE_SVG has viewBox 0 0 10 10 → right should contain 10×10
    expect(footer.textContent).toMatch(/10×10/);
  });

  it('Source mode mounts a read-only comment-gutter editor over the raw markup with the injected model', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    fireEvent.mouseDown(screen.getByTestId('viewer-svg-source-toggle'));

    const wrapper = screen.getByTestId('viewer-svg-source');
    expect(wrapper.className).toContain('mf-editor-selectable');
    expect(wrapper.querySelector('[data-testid="mock-cm-editor-with-comments"]')).not.toBeNull();

    const props = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    expect(props).toMatchObject({
      value: SAMPLE_SVG,
      language: 'html',
      readOnly: true,
      path: '/a/b/icon.svg',
      filePath: '/a/b/icon.svg',
    });
    expect(props?.model).toBeDefined();
  });

  it('Preview exposes no add-note control (no editor mounted at all)', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    expect(screen.queryByTestId('viewer-svg-source')).toBeNull();
    expect(screen.queryByTestId('mock-cm-editor-with-comments')).toBeNull();
  });

  it('a note plus its draft survives a Preview -> Source -> Preview round trip, with one shared submit bar', () => {
    render(<SvgViewer content={SAMPLE_SVG} path="/a/b/icon.svg" />);
    fireEvent.mouseDown(screen.getByTestId('viewer-svg-source-toggle'));

    const model = capturedCmEditorProps[capturedCmEditorProps.length - 1]!.model!;
    act(() => {
      const id = model.addNote({ startLine: 1, endLine: 1, lineContent: SAMPLE_SVG });
      model.setDraft(id, 'looks fine');
    });

    expect(screen.getByTestId('editor-submit-review')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('viewer-svg-preview-toggle'));
    // The submit bar is owned above the mode toggle, so it stays visible.
    expect(screen.getByTestId('editor-submit-review')).toBeInTheDocument();
    expect(screen.queryByTestId('viewer-svg-source')).toBeNull();

    fireEvent.mouseDown(screen.getByTestId('viewer-svg-source-toggle'));
    const modelAfter = capturedCmEditorProps[capturedCmEditorProps.length - 1]!.model!;
    expect(modelAfter.notes).toHaveLength(1);
    expect(modelAfter.drafts[modelAfter.notes[0]!.id]).toBe('looks fine');
  });
});
