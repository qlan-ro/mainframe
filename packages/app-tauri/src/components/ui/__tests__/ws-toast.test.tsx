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
    render(
      <WsToastCard
        id="t1"
        type="success"
        title="Operation complete"
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('Operation complete')).toBeTruthy();
  });

  it('renders the description when provided', () => {
    render(
      <WsToastCard
        id="t1"
        type="info"
        title="Info"
        description="Some details"
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('Some details')).toBeTruthy();
  });

  it('does not render the description when omitted', () => {
    render(
      <WsToastCard
        id="t1"
        type="info"
        title="Info"
        onDismiss={vi.fn()}
      />,
    );
    // Only the title should be in the document; no description node
    expect(screen.queryByRole('paragraph')).toBeNull();
  });

  it('has a card root with data-testid="toast-root"', () => {
    render(
      <WsToastCard
        id="t1"
        type="success"
        title="Done"
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId('toast-root')).toBeTruthy();
  });

  it('renders the dismiss button with data-testid="toast-dismiss"', () => {
    render(
      <WsToastCard
        id="t1"
        type="success"
        title="Done"
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId('toast-dismiss')).toBeTruthy();
  });

  it('calls onDismiss with the toast id when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(
      <WsToastCard
        id="my-toast"
        type="success"
        title="Done"
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId('toast-dismiss'));
    expect(onDismiss).toHaveBeenCalledWith('my-toast');
  });

  it('renders the "Open session →" CTA when chatId is provided', () => {
    render(
      <WsToastCard
        id="t1"
        type="info"
        title="Session ready"
        chatId="chat-abc"
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId('toast-open-session')).toBeTruthy();
    expect(screen.getByText('Open session →')).toBeTruthy();
  });

  it('does not render the CTA when no chatId is provided', () => {
    render(
      <WsToastCard
        id="t1"
        type="info"
        title="Info"
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('toast-open-session')).toBeNull();
  });

  it('error variant: does not render a countdown rail', () => {
    const { container } = render(
      <WsToastCard
        id="t1"
        type="error"
        title="Something failed"
        onDismiss={vi.fn()}
      />,
    );
    // The rail has data-testid="toast-countdown-rail" — absent for errors
    expect(container.querySelector('[data-testid="toast-countdown-rail"]')).toBeNull();
  });

  it('success variant: renders a countdown rail', () => {
    const { container } = render(
      <WsToastCard
        id="t1"
        type="success"
        title="Done"
        onDismiss={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="toast-countdown-rail"]')).toBeTruthy();
  });

  it('success variant: has correct chip class markers', () => {
    render(
      <WsToastCard
        id="t1"
        type="success"
        title="Done"
        onDismiss={vi.fn()}
      />,
    );
    const chip = screen.getByTestId('toast-status-chip');
    expect(chip.className).toContain('bg-mf-success-tint');
    expect(chip.className).toContain('text-mf-success');
  });

  it('error variant: has correct chip class markers', () => {
    render(
      <WsToastCard
        id="t1"
        type="error"
        title="Oops"
        onDismiss={vi.fn()}
      />,
    );
    const chip = screen.getByTestId('toast-status-chip');
    expect(chip.className).toContain('bg-mf-destructive-tint');
    expect(chip.className).toContain('text-destructive');
  });

  it('warning variant: has correct chip class markers', () => {
    render(
      <WsToastCard
        id="t1"
        type="warning"
        title="Watch out"
        onDismiss={vi.fn()}
      />,
    );
    const chip = screen.getByTestId('toast-status-chip');
    expect(chip.className).toContain('bg-mf-warning-tint');
    expect(chip.className).toContain('text-mf-warning');
  });

  it('info variant: has correct chip class markers', () => {
    render(
      <WsToastCard
        id="t1"
        type="info"
        title="Note"
        onDismiss={vi.fn()}
      />,
    );
    const chip = screen.getByTestId('toast-status-chip');
    expect(chip.className).toContain('bg-primary/10');
    expect(chip.className).toContain('text-primary');
  });

  it('warning variant: renders a countdown rail', () => {
    const { container } = render(
      <WsToastCard
        id="t1"
        type="warning"
        title="Watch out"
        onDismiss={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="toast-countdown-rail"]')).toBeTruthy();
  });

  it('info variant: renders a countdown rail', () => {
    const { container } = render(
      <WsToastCard
        id="t1"
        type="info"
        title="Note"
        onDismiss={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="toast-countdown-rail"]')).toBeTruthy();
  });

  it('error variant: auto-dismiss does not fire after 4200ms', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <WsToastCard
        id="t1"
        type="error"
        title="Persistent error"
        onDismiss={onDismiss}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('success variant: auto-dismiss fires after 4200ms', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <WsToastCard
        id="t1"
        type="success"
        title="Done"
        onDismiss={onDismiss}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(4200);
    });
    expect(onDismiss).toHaveBeenCalledWith('t1');
    vi.useRealTimers();
  });
});
