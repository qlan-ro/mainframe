import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MarkdownEditorTab } from '../MarkdownEditorTab';
import { MarkdownPreview } from '../MarkdownPreview';

const MD = '# Title\n\nSome **bold** text.\n\n- one\n- two\n';

describe('MarkdownPreview', () => {
  it('renders markdown as HTML (heading + list + bold)', () => {
    render(<MarkdownPreview value={MD} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Title');
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('MarkdownEditorTab', () => {
  it('starts in Edit mode showing the CM6 editor, not the preview', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);
    expect(document.querySelector('.cm-editor')).toBeTruthy();
    expect(screen.queryByTestId('markdown-preview')).toBeNull();
  });

  it('switches to Preview mode and back to Edit', () => {
    render(<MarkdownEditorTab value={MD} path="/notes.md" onChange={() => {}} />);

    fireEvent.click(screen.getByTestId('markdown-mode-preview'));
    expect(screen.getByTestId('markdown-preview')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Title');

    fireEvent.click(screen.getByTestId('markdown-mode-edit'));
    expect(screen.queryByTestId('markdown-preview')).toBeNull();
    expect(document.querySelector('.cm-editor')).toBeTruthy();
  });
});
