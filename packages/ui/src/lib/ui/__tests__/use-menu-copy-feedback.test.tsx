/**
 * Behavior tests for useMenuCopyFeedback — the shared copy-feedback +
 * delayed-close mechanism extracted from LinkWithPreview (markdown-text.tsx).
 *
 * Uses a tiny harness component with two items so item identity (statusFor)
 * is exercised the same way a real ContextMenu with multiple items would.
 * The copy runs are async because the feedback must report what the clipboard
 * write actually did — a rejected write reads "Copy failed", never "Copied".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useMenuCopyFeedback } from '../use-menu-copy-feedback';

type Run = () => Promise<boolean>;

function label(status: string, idle: string): string {
  if (status === 'copied') return 'Copied';
  if (status === 'failed') return 'Copy failed';
  return idle;
}

function Harness({ runA, runB }: { runA: Run; runB: Run }) {
  const { statusFor, handleOpenChange, onCopySelect } = useMenuCopyFeedback();
  return (
    <div>
      <button data-testid="item-a" onClick={(e) => onCopySelect('a', runA)(e.nativeEvent)}>
        {label(statusFor('a'), 'Copy A')}
      </button>
      <button data-testid="item-b" onClick={(e) => onCopySelect('b', runB)(e.nativeEvent)}>
        {label(statusFor('b'), 'Copy B')}
      </button>
      <button data-testid="close-menu" onClick={() => handleOpenChange(false)}>
        close
      </button>
    </div>
  );
}

/** Lets the copy promise settle so the feedback state lands. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

const ok: Run = () => Promise.resolve(true);
const rejected: Run = () => Promise.resolve(false);

describe('useMenuCopyFeedback', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('onCopySelect prevents default, runs the callback, and marks only the clicked item copied', async () => {
    const runA = vi.fn(ok);
    const runB = vi.fn(ok);
    render(<Harness runA={runA} runB={runB} />);

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(screen.getByTestId('item-a'), clickEvent);
    await flush();

    expect(runA).toHaveBeenCalledTimes(1);
    expect(runB).not.toHaveBeenCalled();
    expect(screen.getByTestId('item-a').textContent).toBe('Copied');
    expect(screen.getByTestId('item-b').textContent).toBe('Copy B');
    expect(clickEvent.defaultPrevented).toBe(true);
  });

  it('reports a rejected copy as failed and never claims it was copied', async () => {
    render(<Harness runA={rejected} runB={ok} />);

    fireEvent.click(screen.getByTestId('item-a'));
    await flush();

    expect(screen.getByTestId('item-a').textContent).toBe('Copy failed');
  });

  it('shows no feedback until the copy settles', async () => {
    let settle: ((value: boolean) => void) | undefined;
    const pending: Run = () => new Promise<boolean>((resolve) => (settle = resolve));
    render(<Harness runA={pending} runB={ok} />);

    fireEvent.click(screen.getByTestId('item-a'));
    await flush();
    expect(screen.getByTestId('item-a').textContent).toBe('Copy A');

    await act(async () => {
      settle?.(true);
    });
    expect(screen.getByTestId('item-a').textContent).toBe('Copied');
  });

  it('dispatches a bubbling Escape keydown on document ~900ms after copy, exactly once', async () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    render(<Harness runA={ok} runB={ok} />);

    fireEvent.click(screen.getByTestId('item-a'));
    await flush();
    act(() => {
      vi.advanceTimersByTime(900);
    });

    const escapeCalls = dispatchSpy.mock.calls.filter(
      ([event]) => event instanceof KeyboardEvent && event.key === 'Escape' && event.bubbles,
    );
    expect(escapeCalls).toHaveLength(1);
  });

  it('handleOpenChange(false) clears the feedback and cancels the pending timer', async () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    render(<Harness runA={ok} runB={ok} />);

    fireEvent.click(screen.getByTestId('item-a'));
    await flush();
    expect(screen.getByTestId('item-a').textContent).toBe('Copied');

    fireEvent.click(screen.getByTestId('close-menu'));
    expect(screen.getByTestId('item-a').textContent).toBe('Copy A');

    dispatchSpy.mockClear();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const escapeCalls = dispatchSpy.mock.calls.filter(
      ([event]) => event instanceof KeyboardEvent && event.key === 'Escape',
    );
    expect(escapeCalls).toHaveLength(0);
  });

  it('cancels the pending timer on unmount', async () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    const { unmount } = render(<Harness runA={ok} runB={ok} />);

    fireEvent.click(screen.getByTestId('item-a'));
    await flush();
    unmount();

    dispatchSpy.mockClear();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const escapeCalls = dispatchSpy.mock.calls.filter(
      ([event]) => event instanceof KeyboardEvent && event.key === 'Escape',
    );
    expect(escapeCalls).toHaveLength(0);
  });

  it('ignores a copy that settles after unmount', async () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    let settle: ((value: boolean) => void) | undefined;
    const pending: Run = () => new Promise<boolean>((resolve) => (settle = resolve));
    const { unmount } = render(<Harness runA={pending} runB={ok} />);

    fireEvent.click(screen.getByTestId('item-a'));
    unmount();

    dispatchSpy.mockClear();
    await act(async () => {
      settle?.(true);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const escapeCalls = dispatchSpy.mock.calls.filter(
      ([event]) => event instanceof KeyboardEvent && event.key === 'Escape',
    );
    expect(escapeCalls).toHaveLength(0);
  });

  it('ignores a successful settle that lands after the menu was already closed', async () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    let settle: ((value: boolean) => void) | undefined;
    const pending: Run = () => new Promise<boolean>((resolve) => (settle = resolve));
    render(<Harness runA={pending} runB={ok} />);

    fireEvent.click(screen.getByTestId('item-a'));
    await flush();
    fireEvent.click(screen.getByTestId('close-menu'));

    dispatchSpy.mockClear();
    await act(async () => {
      settle?.(true);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const escapeCalls = dispatchSpy.mock.calls.filter(
      ([event]) => event instanceof KeyboardEvent && event.key === 'Escape',
    );
    expect(escapeCalls).toHaveLength(0);
    expect(screen.getByTestId('item-a').textContent).toBe('Copy A');
  });

  it('ignores a failed settle that lands after the menu was already closed', async () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    let settle: ((value: boolean) => void) | undefined;
    const pending: Run = () => new Promise<boolean>((resolve) => (settle = resolve));
    render(<Harness runA={pending} runB={ok} />);

    fireEvent.click(screen.getByTestId('item-a'));
    await flush();
    fireEvent.click(screen.getByTestId('close-menu'));

    dispatchSpy.mockClear();
    await act(async () => {
      settle?.(false);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const escapeCalls = dispatchSpy.mock.calls.filter(
      ([event]) => event instanceof KeyboardEvent && event.key === 'Escape',
    );
    expect(escapeCalls).toHaveLength(0);
    expect(screen.getByTestId('item-a').textContent).toBe('Copy A');
  });

  it('still reports a copy started after the menu was closed', async () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    render(<Harness runA={ok} runB={ok} />);

    fireEvent.click(screen.getByTestId('close-menu'));
    dispatchSpy.mockClear();

    fireEvent.click(screen.getByTestId('item-a'));
    await flush();

    expect(screen.getByTestId('item-a').textContent).toBe('Copied');

    act(() => {
      vi.advanceTimersByTime(900);
    });
    const escapeCalls = dispatchSpy.mock.calls.filter(
      ([event]) => event instanceof KeyboardEvent && event.key === 'Escape' && event.bubbles,
    );
    expect(escapeCalls).toHaveLength(1);
  });
});
