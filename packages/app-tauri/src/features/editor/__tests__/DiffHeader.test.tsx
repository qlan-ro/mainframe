/**
 * DiffHeader unit tests.
 *
 * Asserts:
 *  - filename renders
 *  - "N changes" text renders with the given changeCount
 *  - clicking diff-prev-change calls onPrev
 *  - clicking diff-next-change calls onNext
 *  - both buttons are disabled when changeCount === 0
 *  - both buttons are enabled when changeCount > 0
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiffHeader } from '../DiffHeader';

describe('DiffHeader', () => {
  it('renders the fileName', () => {
    render(<DiffHeader fileName="index.ts" changeCount={3} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText('index.ts')).toBeTruthy();
  });

  it('renders the correct change count text', () => {
    render(<DiffHeader fileName="app.tsx" changeCount={5} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText('5 changes')).toBeTruthy();
  });

  it('renders "0 changes" when changeCount is 0', () => {
    render(<DiffHeader fileName="app.tsx" changeCount={0} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText('0 changes')).toBeTruthy();
  });

  it('calls onPrev when the diff-prev-change button is clicked', async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    render(<DiffHeader fileName="file.ts" changeCount={2} onPrev={onPrev} onNext={vi.fn()} />);
    await user.click(screen.getByTestId('diff-prev-change'));
    expect(onPrev).toHaveBeenCalledOnce();
  });

  it('calls onNext when the diff-next-change button is clicked', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    render(<DiffHeader fileName="file.ts" changeCount={2} onPrev={vi.fn()} onNext={onNext} />);
    await user.click(screen.getByTestId('diff-next-change'));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('disables both buttons when changeCount === 0', () => {
    render(<DiffHeader fileName="file.ts" changeCount={0} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByTestId('diff-prev-change')).toBeDisabled();
    expect(screen.getByTestId('diff-next-change')).toBeDisabled();
  });

  it('enables both buttons when changeCount > 0', () => {
    render(<DiffHeader fileName="file.ts" changeCount={1} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByTestId('diff-prev-change')).not.toBeDisabled();
    expect(screen.getByTestId('diff-next-change')).not.toBeDisabled();
  });
});
