/**
 * ComposerHighlight — unit tests for the color-only overlay component.
 *
 * Strategy:
 *  - Mock `@assistant-ui/react` to expose a controlled `useAuiState` that
 *    returns a fixed composer.text slice. This exercises the real selector
 *    path `(s) => s.composer.text` against a fake state object.
 *  - Assert the overlay has `aria-hidden="true"`, `pointer-events-none`,
 *    `data-testid="composer-prompt-highlight"`, and renders the mention highlighted.
 *
 * Behaviors:
 *  1. Live composer text with an @mention → overlay shows accent-colored span
 *  2. Empty composer text → overlay renders nothing (no children)
 *  3. overlay is aria-hidden and pointer-events-none in all cases
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be before the subject import so vi.mock hoisting works
// ---------------------------------------------------------------------------

// We invoke the real selector `(s) => s.composer.text` against a controlled
// fake state object. __composerText drives the returned value per-test.
let __composerText = 'hi @a/b.ts';

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: { composer: { text: string } }) => unknown) => sel({ composer: { text: __composerText } }),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { ComposerHighlight } from '../ComposerHighlight';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ComposerHighlight', () => {
  it('renders the live composer text with the mention highlighted, aria-hidden + non-interactive', () => {
    __composerText = 'hi @a/b.ts';
    render(<ComposerHighlight />);

    const overlay = screen.getByTestId('composer-prompt-highlight');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(overlay.className).toContain('pointer-events-none');
    expect(overlay.querySelector('span.text-primary')?.textContent).toBe('@a/b.ts');
  });

  it('renders nothing inside the overlay when composer text is empty', () => {
    __composerText = '';
    render(<ComposerHighlight />);

    const overlay = screen.getByTestId('composer-prompt-highlight');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    // No highlight spans when there's nothing to highlight
    expect(overlay.querySelector('span.text-primary')).toBeNull();
    expect(overlay.textContent).toBe('');
  });

  it('preserves the data-testid regardless of text content', () => {
    __composerText = '/review the diff';
    render(<ComposerHighlight />);

    expect(screen.getByTestId('composer-prompt-highlight')).toBeInTheDocument();
  });
});
