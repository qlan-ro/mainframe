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

  it.each([
    [5, '5 changes'],
    [0, '0 changes'],
  ])('renders the "%i changes" fallback when no additions/deletions provided', (changeCount, label) => {
    render(<DiffHeader fileName="app.tsx" changeCount={changeCount} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText(label)).toBeTruthy();
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

  it('calls onPrev / onNext when the matching nav button is clicked', async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<DiffHeader fileName="file.ts" changeCount={2} onPrev={onPrev} onNext={onNext} />);
    await user.click(screen.getByTestId('diff-prev-change'));
    expect(onPrev).toHaveBeenCalledOnce();
    expect(onNext).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('diff-next-change'));
    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrev).toHaveBeenCalledOnce();
  });

  it.each([
    ['disables', 0],
    ['enables', 1],
  ])('%s both nav buttons when changeCount is %i', (mode, changeCount) => {
    render(<DiffHeader fileName="file.ts" changeCount={changeCount} onPrev={vi.fn()} onNext={vi.fn()} />);
    for (const id of ['diff-prev-change', 'diff-next-change']) {
      if (mode === 'disables') expect(screen.getByTestId(id)).toBeDisabled();
      else expect(screen.getByTestId(id)).not.toBeDisabled();
    }
  });

  it('renders the toolbar with aria-label="Diff navigation"', () => {
    render(<DiffHeader fileName="file.ts" changeCount={2} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole('toolbar', { name: 'Diff navigation' })).toBeTruthy();
  });

  it('renders the Reveal button (diff-reveal) only when filePath is provided', () => {
    const { unmount } = render(
      <DiffHeader fileName="file.ts" changeCount={1} filePath="/src/file.ts" onPrev={vi.fn()} onNext={vi.fn()} />,
    );
    expect(screen.getByTestId('diff-reveal')).toBeTruthy();
    unmount();
    render(<DiffHeader fileName="file.ts" changeCount={1} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(screen.queryByTestId('diff-reveal')).toBeNull();
  });
});
