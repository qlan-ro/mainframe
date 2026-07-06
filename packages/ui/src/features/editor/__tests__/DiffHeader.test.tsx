/**
 * DiffHeader unit tests.
 *
 * Asserts:
 *  - fileName / path renders
 *  - "N changes" fallback text renders when additions/deletions are not provided
 *  - "+N" / "−N" counts render when additions/deletions are provided
 *  - clicking diff-prev-change calls onPrev
 *  - clicking diff-next-change calls onNext
 *  - both buttons are disabled when changeCount === 0
 *  - both buttons are enabled when changeCount > 0
 *  - GitBranch icon is rendered (toolbar role present)
 *  - Reveal button renders when filePath is provided
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiffHeader } from '../DiffHeader';

// Mock surface-intents so reveal button doesn't crash in jsdom
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: vi.fn(),
}));

describe('DiffHeader', () => {
  it('renders the fileName / path', () => {
    render(<DiffHeader fileName="index.ts" changeCount={3} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText('index.ts')).toBeTruthy();
  });

  it('renders "N changes" fallback when no additions/deletions provided', () => {
    render(<DiffHeader fileName="app.tsx" changeCount={5} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText('5 changes')).toBeTruthy();
  });

  it('renders "0 changes" fallback when changeCount is 0 and no stats', () => {
    render(<DiffHeader fileName="app.tsx" changeCount={0} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText('0 changes')).toBeTruthy();
  });

  it('renders "+N" and "−N" counts when additions and deletions are provided', () => {
    render(
      <DiffHeader fileName="file.ts" changeCount={3} additions={12} deletions={4} onPrev={vi.fn()} onNext={vi.fn()} />,
    );
    expect(screen.getByText('+12')).toBeTruthy();
    expect(screen.getByText('−4')).toBeTruthy();
    // "N changes" fallback should NOT appear when stats are provided
    expect(screen.queryByText('3 changes')).toBeNull();
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

  it('renders the toolbar with aria-label="Diff navigation"', () => {
    render(<DiffHeader fileName="file.ts" changeCount={2} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole('toolbar', { name: 'Diff navigation' })).toBeTruthy();
  });

  it('renders a Reveal button (diff-reveal) when filePath is provided', () => {
    render(<DiffHeader fileName="file.ts" changeCount={1} filePath="/src/file.ts" onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByTestId('diff-reveal')).toBeTruthy();
  });

  it('does not render a Reveal button when filePath is not provided', () => {
    render(<DiffHeader fileName="file.ts" changeCount={1} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.queryByTestId('diff-reveal')).toBeNull();
  });
});
