import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MarkdownEditorTab } from '../MarkdownEditorTab';
import { MarkdownPreview } from '../MarkdownPreview';

const MD = '# Title\n\nSome **bold** text.\n\n- one\n- two\n';

// Mock surface-intents so ViewerShell's reveal button doesn't crash in preview mode.
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

// Capture props passed to CmEditor to assert readOnly forwarding.
type CmEditorProps = ComponentProps<typeof import('../CmEditor').CmEditor>;
const capturedCmEditorProps: CmEditorProps[] = [];

vi.mock('../CmEditor', () => ({
  CmEditor: (props: CmEditorProps) => {
    capturedCmEditorProps.push(props);
    return <div data-testid="cm-editor-mock" className="cm-editor" />;
  },
}));

describe('MarkdownPreview', () => {
  it('renders markdown as HTML (heading + list + bold)', () => {
    render(<MarkdownPreview value={MD} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Title');
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('MarkdownEditorTab', () => {
  beforeEach(() => {
    capturedCmEditorProps.length = 0;
  });

  it('starts in Edit mode showing the CM6 editor, not the preview', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);
    expect(screen.getByTestId('cm-editor-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('markdown-preview')).toBeNull();
  });

  it('switches to Preview mode and back to Edit', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);

    fireEvent.click(screen.getByTestId('markdown-mode-preview'));
    expect(screen.getByTestId('markdown-preview')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Title');

    fireEvent.click(screen.getByTestId('markdown-mode-edit'));
    expect(screen.queryByTestId('markdown-preview')).toBeNull();
    expect(screen.getByTestId('cm-editor-mock')).toBeInTheDocument();
  });

  it('wraps the preview in ViewerShell when in preview mode', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);

    // Switch to Preview mode
    fireEvent.click(screen.getByTestId('markdown-mode-preview'));

    // ViewerShell should be present
    expect(screen.getByTestId('viewer-shell')).toBeInTheDocument();
    expect(screen.getByTestId('viewer-shell-status')).toBeInTheDocument();
  });

  it('status shows word count and line count in preview mode', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);

    fireEvent.click(screen.getByTestId('markdown-mode-preview'));

    const status = screen.getByTestId('viewer-shell-status');
    expect(status.textContent).toMatch(/Markdown/);
    expect(status.textContent).toMatch(/words/);
    expect(status.textContent).toMatch(/lines/);
  });

  it('passes readOnly={true} to CmEditor when readOnly prop is set', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} readOnly />);

    const lastProps = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    expect(lastProps?.readOnly).toBe(true);
  });

  it('passes readOnly={false} to CmEditor by default', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);

    const lastProps = capturedCmEditorProps[capturedCmEditorProps.length - 1];
    expect(lastProps?.readOnly).toBe(false);
  });
});
