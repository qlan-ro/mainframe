/**
 * InlineCommentWidget component tests.
 *
 * Tests the React card rendered inside the CM6 block widget portal:
 *   - textarea is focused on mount
 *   - typing updates text via onTextChange
 *   - ⌘↩ calls onSave (when text is non-empty)
 *   - Escape calls onClose
 *   - Cancel button calls onClose
 *   - Close (X) button in header calls onClose
 *   - "Add context" button is disabled when text is empty; enabled when non-empty
 *   - "Add context" button click calls onSave
 *   - data-testid attributes are present
 *   - optional lineNumber renders range label in the header
 *   - lineContent renders a code snippet preview block
 *   - Send button fires onSend when text is non-empty
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineCommentWidget } from '../InlineCommentWidget';

describe('InlineCommentWidget', () => {
  const defaultProps = {
    text: '',
    onTextChange: () => undefined,
    onSave: () => undefined,
    onClose: () => undefined,
  };

  it('renders the editor-comment-widget testid', () => {
    render(<InlineCommentWidget {...defaultProps} />);
    expect(screen.getByTestId('editor-comment-widget')).toBeTruthy();
  });

  it('renders a textarea with the editor-comment-widget-input testid', () => {
    render(<InlineCommentWidget {...defaultProps} />);
    expect(screen.getByTestId('editor-comment-widget-input')).toBeTruthy();
  });

  it('renders the cancel button with editor-comment-widget-cancel testid', () => {
    render(<InlineCommentWidget {...defaultProps} />);
    expect(screen.getByTestId('editor-comment-widget-cancel')).toBeTruthy();
  });

  it('renders the save button with editor-comment-widget-save testid', () => {
    render(<InlineCommentWidget {...defaultProps} />);
    expect(screen.getByTestId('editor-comment-widget-save')).toBeTruthy();
  });

  it('renders the header close button with editor-comment-widget-close testid', () => {
    render(<InlineCommentWidget {...defaultProps} />);
    expect(screen.getByTestId('editor-comment-widget-close')).toBeTruthy();
  });

  it('renders "Review comment" header label', () => {
    render(<InlineCommentWidget {...defaultProps} />);
    expect(screen.getByText('Review comment')).toBeTruthy();
  });

  it('renders range label "L4–5" when lineNumber=4 and endLine=5', () => {
    render(<InlineCommentWidget {...defaultProps} lineNumber={4} endLine={5} />);
    expect(screen.getByText('L4–5')).toBeTruthy();
  });

  it('renders range label "L4" when lineNumber=4 with no endLine', () => {
    render(<InlineCommentWidget {...defaultProps} lineNumber={4} />);
    expect(screen.getByText('L4')).toBeTruthy();
  });

  it('does not render a line label when lineNumber is not provided', () => {
    render(<InlineCommentWidget {...defaultProps} />);
    const text = document.body.textContent ?? '';
    expect(/L\d/.test(text)).toBe(false);
  });

  it('renders snippet block when lineContent is set', () => {
    render(<InlineCommentWidget {...defaultProps} lineContent={'const a = 1\nconst b = 2'} lineNumber={4} />);
    expect(screen.getByTestId('editor-comment-widget-snippet')).toBeTruthy();
  });

  it('renders both lines in the snippet block', () => {
    render(<InlineCommentWidget {...defaultProps} lineContent={'const a = 1\nconst b = 2'} lineNumber={4} />);
    expect(screen.getByText('const a = 1')).toBeTruthy();
    expect(screen.getByText('const b = 2')).toBeTruthy();
  });

  it('does NOT render snippet block when lineContent is empty/undefined', () => {
    render(<InlineCommentWidget {...defaultProps} />);
    expect(screen.queryByTestId('editor-comment-widget-snippet')).toBeNull();
  });

  it('does NOT render snippet block when lineContent is empty string', () => {
    render(<InlineCommentWidget {...defaultProps} lineContent="" />);
    expect(screen.queryByTestId('editor-comment-widget-snippet')).toBeNull();
  });

  it('renders Send button with editor-comment-widget-send testid', () => {
    render(<InlineCommentWidget {...defaultProps} onSend={() => undefined} />);
    expect(screen.getByTestId('editor-comment-widget-send')).toBeTruthy();
  });

  it('clicking Send button fires onSend when text is non-empty', async () => {
    const onSend = vi.fn();
    render(<InlineCommentWidget {...defaultProps} text="my review note" onSend={onSend} />);
    await userEvent.click(screen.getByTestId('editor-comment-widget-send'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onSend when text is empty', async () => {
    const onSend = vi.fn();
    render(<InlineCommentWidget {...defaultProps} text="" onSend={onSend} />);
    await userEvent.click(screen.getByTestId('editor-comment-widget-send'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('calls onTextChange when user types', async () => {
    const onTextChange = vi.fn();
    render(<InlineCommentWidget {...defaultProps} onTextChange={onTextChange} />);
    const textarea = screen.getByTestId('editor-comment-widget-input');
    await userEvent.type(textarea, 'a');
    expect(onTextChange).toHaveBeenCalled();
  });

  it('calls onSave when ⌘↩ is pressed and text is non-empty', async () => {
    const onSave = vi.fn();
    render(<InlineCommentWidget {...defaultProps} text="some note" onSave={onSave} />);
    const textarea = screen.getByTestId('editor-comment-widget-input');
    await userEvent.type(textarea, '{Meta>}{Enter}{/Meta}');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onSave on plain Enter (must be ⌘↩)', async () => {
    const onSave = vi.fn();
    render(<InlineCommentWidget {...defaultProps} text="note" onSave={onSave} />);
    const textarea = screen.getByTestId('editor-comment-widget-input');
    await userEvent.type(textarea, '{Enter}');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn();
    render(<InlineCommentWidget {...defaultProps} onClose={onClose} />);
    const textarea = screen.getByTestId('editor-comment-widget-input');
    await userEvent.type(textarea, '{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Cancel button is clicked', async () => {
    const onClose = vi.fn();
    render(<InlineCommentWidget {...defaultProps} onClose={onClose} />);
    await userEvent.click(screen.getByTestId('editor-comment-widget-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when header close (X) button is clicked', async () => {
    const onClose = vi.fn();
    render(<InlineCommentWidget {...defaultProps} onClose={onClose} />);
    await userEvent.click(screen.getByTestId('editor-comment-widget-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"Add context" button is disabled when text is empty', () => {
    render(<InlineCommentWidget {...defaultProps} text="" />);
    const saveBtn = screen.getByTestId('editor-comment-widget-save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('"Add context" button is enabled when text is non-empty', () => {
    render(<InlineCommentWidget {...defaultProps} text="hello" />);
    const saveBtn = screen.getByTestId('editor-comment-widget-save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it('calls onSave when "Add context" button is clicked with non-empty text', async () => {
    const onSave = vi.fn();
    render(<InlineCommentWidget {...defaultProps} text="my note" onSave={onSave} />);
    await userEvent.click(screen.getByTestId('editor-comment-widget-save'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('save button label is "Add context"', () => {
    render(<InlineCommentWidget {...defaultProps} />);
    const saveBtn = screen.getByTestId('editor-comment-widget-save');
    expect(saveBtn.textContent).toBe('Add context');
  });

  it('shows "⌘↩ to add" hint in the footer', () => {
    render(<InlineCommentWidget {...defaultProps} />);
    expect(screen.getByText('⌘↩ to add')).toBeTruthy();
  });
});
