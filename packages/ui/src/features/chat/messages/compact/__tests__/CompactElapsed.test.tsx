import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CompactElapsed } from '../CompactElapsed';

afterEach(() => vi.useRealTimers());
it('ticks in isolation, freezes at supplied completion and preserves supplied start on remount', () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  let renders = 0;
  function Parent({ running = true }: { running?: boolean }) {
    renders++;
    return (
      <CompactElapsed timing={{ startedAt: 5000, ...(running ? {} : { completedAt: 12500 }) }} running={running} />
    );
  }
  const view = render(<Parent />);
  expect(screen.getByText('0:05')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.getByText('0:08')).toBeInTheDocument();
  expect(renders).toBe(1);
  view.rerender(<Parent running={false} />);
  expect(screen.getByText('0:07')).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.getByText('0:07')).toBeInTheDocument();
  view.unmount();
  render(<Parent />);
  expect(screen.getByText('0:11')).toBeInTheDocument();
  expect(screen.queryByRole('status')).toBeNull();
});
it('omits untimed calls instead of starting a mount clock', () => {
  const { container } = render(<CompactElapsed running />);
  expect(container).toBeEmptyDOMElement();
});
