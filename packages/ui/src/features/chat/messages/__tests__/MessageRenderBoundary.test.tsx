/**
 * Behavior tests for MessageRenderBoundary.
 *
 * Strategy:
 *  - Case 1: children render normally when no child throws.
 *  - Case 2: when a child throws, the boundary swallows the error,
 *    renders null (no child output visible), and calls our
 *    console.warn with the '[message-render-boundary]' tag.
 *
 * React logs caught errors to console.error in dev regardless of the
 * boundary — we suppress that noise via a mock so test output stays clean,
 * but the behavioral assertion is on OUR console.warn and the null render.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MessageRenderBoundary } from '../MessageRenderBoundary';

// ---------------------------------------------------------------------------
// Helper — a component that always throws during render
// ---------------------------------------------------------------------------

function Boom(): never {
  throw new Error('kaboom');
}

// ---------------------------------------------------------------------------
// Case 1 — children render normally when no error is thrown
// ---------------------------------------------------------------------------

describe('MessageRenderBoundary — happy path', () => {
  it('renders children when no child throws', () => {
    const { getByTestId } = render(
      <MessageRenderBoundary>
        <div data-testid="ok">hello</div>
      </MessageRenderBoundary>,
    );

    const node = getByTestId('ok');
    expect(node).toBeInTheDocument();
    expect(node.textContent).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// Case 2 — boundary catches a render error: null output + console.warn called
// ---------------------------------------------------------------------------

describe('MessageRenderBoundary — error containment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders null and calls console.warn when a child throws', () => {
    // Suppress React's own dev-mode error logging so test output stays clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { container } = render(
      <MessageRenderBoundary>
        <Boom />
      </MessageRenderBoundary>,
    );

    // The boundary renders null — no child output in the DOM.
    expect(container.textContent).toBe('');

    // Our componentDidCatch log was called at least once and carries the tag.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[message-render-boundary]'), expect.any(String));
  });

  it('includes the thrown error message in the console.warn call', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <MessageRenderBoundary>
        <Boom />
      </MessageRenderBoundary>,
    );

    // The second arg to console.warn is error.message — 'kaboom'.
    const [, errorMessage] = warnSpy.mock.calls[0] ?? [];
    expect(errorMessage).toBe('kaboom');
  });
});
