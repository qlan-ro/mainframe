/**
 * Behavior tests for useMenuCopyFeedback — the shared "Copied" delayed-close
 * mechanism extracted from LinkWithPreview (markdown-text.tsx).
 *
 * Uses a tiny harness component with two items so item identity (copiedId)
 * is exercised the same way a real ContextMenu with multiple items would.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useMenuCopyFeedback } from '../use-menu-copy-feedback';

function Harness({ runA, runB }: { runA: () => void; runB: () => void }) {
  const { copiedId, handleOpenChange, onCopySelect } = useMenuCopyFeedback();
  return (
    <div>
      <button data-testid="item-a" onClick={(e) => onCopySelect('a', runA)(e.nativeEvent)}>
        {copiedId === 'a' ? 'Copied' : 'Copy A'}
      </button>
      <button data-testid="item-b" onClick={(e) => onCopySelect('b', runB)(e.nativeEvent)}>
        {copiedId === 'b' ? 'Copied' : 'Copy B'}
      </button>
      <button data-testid="close-menu" onClick={() => handleOpenChange(false)}>
        close
      </button>
    </div>
  );
}

describe('useMenuCopyFeedback', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('onCopySelect prevents default, runs the callback, and sets copiedId only for the clicked item', () => {
    const runA = vi.fn();
    const runB = vi.fn();
    render(<Harness runA={runA} runB={runB} />);

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(screen.getByTestId('item-a'), clickEvent);

    expect(runA).toHaveBeenCalledTimes(1);
    expect(runB).not.toHaveBeenCalled();
    expect(screen.getByTestId('item-a').textContent).toBe('Copied');
    expect(screen.getByTestId('item-b').textContent).toBe('Copy B');
    expect(clickEvent.defaultPrevented).toBe(true);
  });

  it('dispatches a bubbling Escape keydown on document ~900ms after copy, exactly once', () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    const runA = vi.fn();
    render(<Harness runA={runA} runB={vi.fn()} />);

    fireEvent.click(screen.getByTestId('item-a'));
    act(() => {
      vi.advanceTimersByTime(900);
    });

    const escapeCalls = dispatchSpy.mock.calls.filter(
      ([event]) => event instanceof KeyboardEvent && event.key === 'Escape' && event.bubbles,
    );
    expect(escapeCalls).toHaveLength(1);
  });

  it('handleOpenChange(false) clears copiedId and cancels the pending timer', () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    render(<Harness runA={vi.fn()} runB={vi.fn()} />);

    fireEvent.click(screen.getByTestId('item-a'));
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

  it('cancels the pending timer on unmount', () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    const { unmount } = render(<Harness runA={vi.fn()} runB={vi.fn()} />);

    fireEvent.click(screen.getByTestId('item-a'));
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
});
