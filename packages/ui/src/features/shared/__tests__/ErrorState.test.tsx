/**
 * ErrorState + MfErrorBoundary tests.
 *
 * Behaviors covered:
 *  - ErrorState renders the error message in the mono detail block.
 *  - ErrorState uses fallback text when error is null/undefined.
 *  - Copy details button writes msg to clipboard and shows "Copied ✓" then reverts.
 *  - Try again button calls onRetry.
 *  - MfErrorBoundary renders children when there is no error.
 *  - MfErrorBoundary renders ErrorState when a child throws.
 *  - MfErrorBoundary Try again resets the boundary and re-renders children.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Lazy imports — after any mocks are installed.
// ---------------------------------------------------------------------------

const { ErrorState } = await import('../ErrorState');
const { MfErrorBoundary } = await import('../MfErrorBoundary');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A child component that throws synchronously when `boom` is true. */
function BoomChild({ boom }: { boom: boolean }) {
  if (boom) throw new Error('test-error-message');
  return <div data-testid="boom-child-ok">ok</div>;
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

let writeTextMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeTextMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// ErrorState — rendering
// ---------------------------------------------------------------------------

describe('ErrorState — rendering', () => {
  it('renders the error message from the error prop', () => {
    const error = new Error('something-blew-up');
    render(<ErrorState error={error} onRetry={vi.fn()} />);
    expect(screen.getByText('something-blew-up')).toBeTruthy();
  });

  it('renders the fallback text when error is null', () => {
    render(<ErrorState error={null} onRetry={vi.fn()} />);
    expect(screen.getByText('An unexpected error occurred while rendering this view.')).toBeTruthy();
  });

  it('renders the card root with data-testid error-state-root', () => {
    render(<ErrorState error={new Error('x')} onRetry={vi.fn()} />);
    expect(screen.getByTestId('error-state-root')).toBeTruthy();
  });

  it('renders all three action buttons', () => {
    render(<ErrorState error={new Error('x')} onRetry={vi.fn()} />);
    expect(screen.getByTestId('error-state-copy')).toBeTruthy();
    expect(screen.getByTestId('error-state-reload')).toBeTruthy();
    expect(screen.getByTestId('error-state-retry')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ErrorState — Copy details
// ---------------------------------------------------------------------------

describe('ErrorState — Copy details', () => {
  it('writes the error message to the clipboard when Copy details is clicked', () => {
    const error = new Error('clipboard-test-error');
    render(<ErrorState error={error} onRetry={vi.fn()} />);

    fireEvent.click(screen.getByTestId('error-state-copy'));

    expect(writeTextMock).toHaveBeenCalledWith('clipboard-test-error');
  });

  it('shows "Copied ✓" immediately after clicking Copy details', () => {
    render(<ErrorState error={new Error('x')} onRetry={vi.fn()} />);

    fireEvent.click(screen.getByTestId('error-state-copy'));

    expect(screen.getByTestId('error-state-copy').textContent).toContain('Copied ✓');
  });

  it('reverts the Copy details label after 1400ms', () => {
    vi.useFakeTimers();
    render(<ErrorState error={new Error('x')} onRetry={vi.fn()} />);

    fireEvent.click(screen.getByTestId('error-state-copy'));
    expect(screen.getByTestId('error-state-copy').textContent).toContain('Copied ✓');

    act(() => {
      vi.advanceTimersByTime(1400);
    });

    expect(screen.getByTestId('error-state-copy').textContent).toContain('Copy details');
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// ErrorState — Try again
// ---------------------------------------------------------------------------

describe('ErrorState — Try again', () => {
  it('calls onRetry when Try again is clicked', () => {
    const onRetry = vi.fn();
    render(<ErrorState error={new Error('x')} onRetry={onRetry} />);

    fireEvent.click(screen.getByTestId('error-state-retry'));

    expect(onRetry).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// MfErrorBoundary
// ---------------------------------------------------------------------------

describe('MfErrorBoundary — no error', () => {
  it('renders children when no error is thrown', () => {
    render(
      <MfErrorBoundary>
        <div data-testid="child-content">hello</div>
      </MfErrorBoundary>,
    );
    expect(screen.getByTestId('child-content')).toBeTruthy();
    expect(screen.queryByTestId('error-state-root')).toBeNull();
  });
});

describe('MfErrorBoundary — error caught', () => {
  // Suppress the React error boundary console.error output in tests
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('renders ErrorState when a child throws', () => {
    render(
      <MfErrorBoundary>
        <BoomChild boom={true} />
      </MfErrorBoundary>,
    );
    expect(screen.getByTestId('error-state-root')).toBeTruthy();
    expect(screen.getByText('test-error-message')).toBeTruthy();
  });

  it('resets and re-renders children when Try again is clicked', () => {
    const { rerender } = render(
      <MfErrorBoundary>
        <BoomChild boom={true} />
      </MfErrorBoundary>,
    );

    expect(screen.getByTestId('error-state-root')).toBeTruthy();

    // Re-render with boom=false so children succeed after reset
    rerender(
      <MfErrorBoundary>
        <BoomChild boom={false} />
      </MfErrorBoundary>,
    );

    act(() => {
      fireEvent.click(screen.getByTestId('error-state-retry'));
    });

    expect(screen.queryByTestId('error-state-root')).toBeNull();
    expect(screen.getByTestId('boom-child-ok')).toBeTruthy();
  });
});
