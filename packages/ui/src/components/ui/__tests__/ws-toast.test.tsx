/**
 * WsToastCard unit tests.
 *
 * Asserts:
 *  - renders title and optional description
 *  - success variant renders the success chip (data-testid="toast-root" with type attribute)
 *  - error variant has no countdown rail
 *  - error variant has no auto-dismiss timer fired
 *  - dismiss button calls the dismiss callback
 *  - chatId renders the CTA link with correct data-testid
 *  - info variant renders a countdown rail when not hovered
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WsToastCard } from '../ws-toast';

// sonner's toast.dismiss is only available at runtime — stub it out.
vi.mock('sonner', () => ({
  toast: {
    dismiss: vi.fn(),
    custom: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('WsToastCard', () => {
  it('renders the title', () => {
    render(<WsToastCard id="t1" type="success" title="Operation complete" onDismiss={vi.fn()} />);
    expect(screen.getByText('Operation complete')).toBeTruthy();
  });

  it('renders the description when provided', () => {
    render(<WsToastCard id="t1" type="info" title="Info" description="Some details" onDismiss={vi.fn()} />);
    expect(screen.getByText('Some details')).toBeTruthy();
  });

  it('does not render the description when omitted', () => {
    render(<WsToastCard id="t1" type="info" title="Info" onDismiss={vi.fn()} />);
    // Only the title should be in the document; no description node
    expect(screen.queryByRole('paragraph')).toBeNull();
  });

  it('has a card root with data-testid="toast-root"', () => {
    render(<WsToastCard id="t1" type="success" title="Done" onDismiss={vi.fn()} />);
    expect(screen.getByTestId('toast-root')).toBeTruthy();
  });

  it('renders the dismiss button with data-testid="toast-dismiss"', () => {
    render(<WsToastCard id="t1" type="success" title="Done" onDismiss={vi.fn()} />);
    expect(screen.getByTestId('toast-dismiss')).toBeTruthy();
  });

  it('calls onDismiss with the toast id when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<WsToastCard id="my-toast" type="success" title="Done" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('toast-dismiss'));
    expect(onDismiss).toHaveBeenCalledWith('my-toast');
  });

  it('renders the "Open session →" CTA when chatId is provided', () => {
    render(<WsToastCard id="t1" type="info" title="Session ready" chatId="chat-abc" onDismiss={vi.fn()} />);
    expect(screen.getByTestId('toast-open-session')).toBeTruthy();
    expect(screen.getByText('Open session →')).toBeTruthy();
  });

  it('CTA click calls onOpenSession with the chatId and then dismisses', () => {
    const onOpenSession = vi.fn();
    const onDismiss = vi.fn();
    render(
      <WsToastCard
        id="t1"
        type="info"
        title="Session ready"
        chatId="chat-abc"
        onOpenSession={onOpenSession}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId('toast-open-session'));
    expect(onOpenSession).toHaveBeenCalledWith('chat-abc');
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });

  it('CTA click still dismisses when no onOpenSession is provided', () => {
    const onDismiss = vi.fn();
    render(<WsToastCard id="t1" type="info" title="Session ready" chatId="chat-abc" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('toast-open-session'));
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });

  it('does not render the CTA when no chatId is provided', () => {
    render(<WsToastCard id="t1" type="info" title="Info" onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('toast-open-session')).toBeNull();
  });

  it('error variant: does not render a countdown rail', () => {
    const { container } = render(<WsToastCard id="t1" type="error" title="Something failed" onDismiss={vi.fn()} />);
    // The rail has data-testid="toast-countdown-rail" — absent for errors
    expect(container.querySelector('[data-testid="toast-countdown-rail"]')).toBeNull();
  });

  it('success variant: renders a countdown rail', () => {
    const { container } = render(<WsToastCard id="t1" type="success" title="Done" onDismiss={vi.fn()} />);
    expect(container.querySelector('[data-testid="toast-countdown-rail"]')).toBeTruthy();
  });

  it('success variant: has correct chip class markers', () => {
    render(<WsToastCard id="t1" type="success" title="Done" onDismiss={vi.fn()} />);
    const chip = screen.getByTestId('toast-status-chip');
    expect(chip.className).toContain('bg-mf-success-tint');
    expect(chip.className).toContain('text-mf-success');
  });

  it('error variant: has correct chip class markers', () => {
    render(<WsToastCard id="t1" type="error" title="Oops" onDismiss={vi.fn()} />);
    const chip = screen.getByTestId('toast-status-chip');
    expect(chip.className).toContain('bg-mf-destructive-tint');
    expect(chip.className).toContain('text-destructive');
  });

  it('warning variant: has correct chip class markers', () => {
    render(<WsToastCard id="t1" type="warning" title="Watch out" onDismiss={vi.fn()} />);
    const chip = screen.getByTestId('toast-status-chip');
    expect(chip.className).toContain('bg-mf-warning-tint');
    expect(chip.className).toContain('text-mf-warning');
  });

  it('info variant: has correct chip class markers', () => {
    render(<WsToastCard id="t1" type="info" title="Note" onDismiss={vi.fn()} />);
    const chip = screen.getByTestId('toast-status-chip');
    expect(chip.className).toContain('bg-primary/10');
    expect(chip.className).toContain('text-primary');
  });

  it('warning variant: renders a countdown rail', () => {
    const { container } = render(<WsToastCard id="t1" type="warning" title="Watch out" onDismiss={vi.fn()} />);
    expect(container.querySelector('[data-testid="toast-countdown-rail"]')).toBeTruthy();
  });

  it('info variant: renders a countdown rail', () => {
    const { container } = render(<WsToastCard id="t1" type="info" title="Note" onDismiss={vi.fn()} />);
    expect(container.querySelector('[data-testid="toast-countdown-rail"]')).toBeTruthy();
  });

  it('mounts with the entrance state (hidden) before the post-mount RAF fires', () => {
    vi.useFakeTimers();
    render(<WsToastCard id="t1" type="success" title="Done" onDismiss={vi.fn()} />);
    const root = screen.getByTestId('toast-root');
    expect(root.style.opacity).toBe('0');
    vi.useRealTimers();
  });

  it('transitions to the entered state (visible) using the ease-signature curve after mount', () => {
    vi.useFakeTimers();
    render(<WsToastCard id="t1" type="success" title="Done" onDismiss={vi.fn()} />);
    const root = screen.getByTestId('toast-root');
    act(() => {
      // rAF-driven entrance — flush the double-rAF used to trigger the transition
      vi.runAllTimers();
    });
    expect(root.style.opacity).toBe('1');
    expect(root.style.transition).toContain('var(--ease-signature)');
    vi.useRealTimers();
  });

  it('error variant: auto-dismiss does not fire after 4200ms', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<WsToastCard id="t1" type="error" title="Persistent error" onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('success variant: auto-dismiss fires after 4200ms', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<WsToastCard id="t1" type="success" title="Done" onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(4200);
    });
    expect(onDismiss).toHaveBeenCalledWith('t1');
    vi.useRealTimers();
  });

  it('cancels both scheduled animation frames on unmount before they fire, so no state update happens after unmount', () => {
    // Mock rAF/cAF so we control exactly when each queued callback runs,
    // and can prove both frame ids get cancelled on unmount.
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    const cancelled = new Set<number>();
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    });
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      cancelled.add(id);
      callbacks.delete(id);
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = render(<WsToastCard id="t1" type="success" title="Done" onDismiss={vi.fn()} />);

    // Flush only the first rAF (raf1), which schedules the second (raf2) but
    // does not run it yet — this is the exact unmount race window.
    const raf1Id = 1;
    const raf1Cb = callbacks.get(raf1Id);
    expect(raf1Cb).toBeDefined();
    raf1Cb?.(0);
    expect(callbacks.has(2)).toBe(true); // raf2 was scheduled by raf1's callback

    unmount();

    // Both frame ids must have been cancelled by the effect cleanup.
    expect(cafSpy).toHaveBeenCalledWith(raf1Id);
    expect(cafSpy).toHaveBeenCalledWith(2);
    expect(cancelled.has(2)).toBe(true);

    // Since raf2 was cancelled (removed from the pending map), "flushing"
    // frames post-unmount is a no-op — proving setEntered can't fire on the
    // unmounted component. No React act()-outside-warning / console.error.
    for (const cb of callbacks.values()) cb(0);
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    rafSpy.mockRestore();
    cafSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
