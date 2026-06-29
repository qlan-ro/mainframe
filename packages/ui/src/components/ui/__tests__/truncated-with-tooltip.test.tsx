import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { TruncatedWithTooltip } from '../truncated-with-tooltip';

describe('TruncatedWithTooltip', () => {
  it('renders the visible text in a truncating span', () => {
    render(<TruncatedWithTooltip text="src/very/long/path.ts" />);
    const span = screen.getByText('src/very/long/path.ts');
    expect(span.className).toContain('truncate');
  });

  it('forwards arbitrary props (e.g. data-testid) to the visible span', () => {
    render(<TruncatedWithTooltip text="hello" data-testid="my-label" />);
    expect(screen.getByTestId('my-label').textContent).toBe('hello');
  });

  it('renders nothing when text is empty', () => {
    const { container } = render(<TruncatedWithTooltip text="" data-testid="empty" />);
    expect(screen.queryByTestId('empty')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Truncation gating — tooltip only opens when it adds information
//
// jsdom reports scrollWidth === clientWidth === 0 for all elements by default,
// so useIsTruncated always returns false unless we override these properties.
// We define the overrides BEFORE render so the layout effect reads them.
// Each case restores the originals in afterEach to prevent cross-test leaks.
// ---------------------------------------------------------------------------

describe('truncation gating', () => {
  afterEach(() => {
    // Restore jsdom defaults (both 0) after each override.
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 0;
      },
    });
  });

  it('does NOT show a tooltip when text fits (not truncated) and no custom tooltip prop', async () => {
    // scrollWidth === clientWidth === 0 → useIsTruncated returns false.
    // No custom `tooltip` prop → canOpen is false → tooltip must stay hidden.
    const user = userEvent.setup();
    render(<TruncatedWithTooltip text="short label" />);
    await user.hover(screen.getByText('short label'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows a tooltip with the full text when the element is truncated and no custom tooltip prop', async () => {
    // scrollWidth (200) > clientWidth (100) + 1 → useIsTruncated returns true.
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        return 200;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 100;
      },
    });
    const user = userEvent.setup();
    render(<TruncatedWithTooltip text="a very long label that gets clipped" />);
    await user.hover(screen.getByText('a very long label that gets clipped'));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('a very long label that gets clipped');
  });

  it('always shows a tooltip when a custom tooltip prop is provided, even when not truncated', async () => {
    // scrollWidth === clientWidth === 0 → not truncated.
    // But a custom `tooltip` prop adds info beyond the visible text → always opens.
    const user = userEvent.setup();
    render(<TruncatedWithTooltip text="auth.ts" tooltip="src/features/auth/auth.ts" />);
    await user.hover(screen.getByText('auth.ts'));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('src/features/auth/auth.ts');
  });
});
