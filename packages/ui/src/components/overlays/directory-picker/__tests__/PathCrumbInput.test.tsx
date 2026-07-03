/**
 * PathCrumbInput — behavior tests.
 *
 * Behaviors covered:
 *  - Enter calls onNavigate with the current draft text.
 *  - Escape (when the draft differs from value) reverts the input to `value`
 *    and does NOT call onNavigate.
 *  - The input re-syncs to `value` when it changes from outside (rerender).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PathCrumbInput } from '../PathCrumbInput';

describe('PathCrumbInput — Enter navigates', () => {
  it('calls onNavigate with the typed draft on Enter', async () => {
    const onNavigate = vi.fn();
    render(<PathCrumbInput value="~" onNavigate={onNavigate} />);

    const input = screen.getByTestId('directory-picker-path-input');
    await userEvent.clear(input);
    await userEvent.type(input, '/Users/me/proj{Enter}');

    expect(onNavigate).toHaveBeenCalledWith('/Users/me/proj');
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

describe('PathCrumbInput — Escape reverts', () => {
  it('reverts the draft to value and does not call onNavigate', async () => {
    const onNavigate = vi.fn();
    render(<PathCrumbInput value="~" onNavigate={onNavigate} />);

    const input = screen.getByTestId('directory-picker-path-input') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, '/Users/me/proj');
    expect(input.value).toBe('/Users/me/proj');

    await userEvent.keyboard('{Escape}');

    expect(input.value).toBe('~');
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe('PathCrumbInput — re-sync on value change', () => {
  it('updates the input value when the `value` prop changes', () => {
    const { rerender } = render(<PathCrumbInput value="~" onNavigate={() => {}} />);

    const input = screen.getByTestId('directory-picker-path-input') as HTMLInputElement;
    expect(input.value).toBe('~');

    rerender(<PathCrumbInput value="/Users/me/other" onNavigate={() => {}} />);

    expect(input.value).toBe('/Users/me/other');
  });
});
