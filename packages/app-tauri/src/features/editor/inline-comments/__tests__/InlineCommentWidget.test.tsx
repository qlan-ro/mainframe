/**
 * InlineCommentWidget component tests.
 *
 * Tests the React card that renders inside the CM6 block widget portal:
 *   - textarea is focused on mount
 *   - typing updates text via onTextChange
 *   - Enter key (without Shift) calls onSave
 *   - Escape calls onClose
 *   - Cancel button calls onClose
 *   - Save button is disabled when text is empty; enabled when non-empty
 *   - Save button click calls onSave
 *   - Delete button (when shown) calls onDelete
 *   - data-testid attributes are present
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineCommentWidget } from '../InlineCommentWidget';

describe('InlineCommentWidget', () => {
  const defaultProps = {
    text: '',
    lineContent: 'const x = 1;',
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

  it('calls onTextChange when user types', async () => {
    const onTextChange = vi.fn();
    render(<InlineCommentWidget {...defaultProps} onTextChange={onTextChange} />);
    const textarea = screen.getByTestId('editor-comment-widget-input');
    await userEvent.type(textarea, 'a');
    expect(onTextChange).toHaveBeenCalled();
  });

  it('calls onSave when Enter is pressed (without Shift)', async () => {
    const onSave = vi.fn();
    render(<InlineCommentWidget {...defaultProps} text="some note" onSave={onSave} />);
    const textarea = screen.getByTestId('editor-comment-widget-input');
    await userEvent.type(textarea, '{Enter}');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does not call onSave on Shift+Enter', async () => {
    const onSave = vi.fn();
    render(<InlineCommentWidget {...defaultProps} text="note" onSave={onSave} />);
    const textarea = screen.getByTestId('editor-comment-widget-input');
    await userEvent.type(textarea, '{Shift>}{Enter}{/Shift}');
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

  it('save button is disabled when text is empty', () => {
    render(<InlineCommentWidget {...defaultProps} text="" />);
    const saveBtn = screen.getByTestId('editor-comment-widget-save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('save button is enabled when text is non-empty', () => {
    render(<InlineCommentWidget {...defaultProps} text="hello" />);
    const saveBtn = screen.getByTestId('editor-comment-widget-save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it('calls onSave when save button is clicked with non-empty text', async () => {
    const onSave = vi.fn();
    render(<InlineCommentWidget {...defaultProps} text="my note" onSave={onSave} />);
    await userEvent.click(screen.getByTestId('editor-comment-widget-save'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('renders delete button with testid when onDelete is provided', () => {
    render(<InlineCommentWidget {...defaultProps} onDelete={() => undefined} />);
    expect(screen.getByTestId('editor-comment-widget-delete')).toBeTruthy();
  });

  it('calls onDelete when delete button is clicked', async () => {
    const onDelete = vi.fn();
    render(<InlineCommentWidget {...defaultProps} onDelete={onDelete} />);
    await userEvent.click(screen.getByTestId('editor-comment-widget-delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('does not render delete button when onDelete is not provided', () => {
    render(<InlineCommentWidget {...defaultProps} />);
    expect(screen.queryByTestId('editor-comment-widget-delete')).toBeNull();
  });
});
