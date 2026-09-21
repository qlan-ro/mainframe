// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotesSubmitBar } from '../NotesSubmitBar';

describe('NotesSubmitBar', () => {
  it('uses the singular "note" at one of one', () => {
    render(<NotesSubmitBar total={1} filled={1} onSubmit={() => {}} />);
    expect(screen.getByTestId('editor-submit-review')).toHaveTextContent('1 of 1 agent note filled');
  });

  it('uses the plural "notes" for any other count', () => {
    render(<NotesSubmitBar total={3} filled={2} onSubmit={() => {}} />);
    expect(screen.getByTestId('editor-submit-review')).toHaveTextContent('2 of 3 agent notes filled');
  });

  it('disables the submit button when no note has text yet', () => {
    render(<NotesSubmitBar total={2} filled={0} onSubmit={() => {}} />);
    expect(screen.getByTestId('editor-submit-review-btn')).toBeDisabled();
  });

  it('enables the submit button and fires onSubmit once at least one note is filled', () => {
    const onSubmit = vi.fn();
    render(<NotesSubmitBar total={2} filled={1} onSubmit={onSubmit} />);
    const button = screen.getByTestId('editor-submit-review-btn');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
