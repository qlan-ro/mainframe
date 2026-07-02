/**
 * SessionGroupHeader — behavior tests.
 *
 * SessionGroupHeader is the label header for one time/status section in the
 * sessions list, rendered by SessionListVirtuoso as GroupedVirtuoso's
 * `groupContent`. It replaced the retired SessionGroup component (which owned
 * both the header AND the item list). Behaviors covered:
 *  1. Renders the group label text in `sessions-group-header-<label>`.
 *  2. Shows a pin glyph (`sessions-group-pin-glyph`) when label === 'Pinned'.
 *  3. Does not show a pin glyph for any other label.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionGroupHeader } from '../SessionGroupHeader';

describe('SessionGroupHeader — renders the label text', () => {
  it('renders the label inside data-testid="sessions-group-header-<label>"', () => {
    render(<SessionGroupHeader label="Today" />);
    const header = screen.getByTestId('sessions-group-header-Today');
    expect(header.textContent).toContain('Today');
  });

  it('renders a different label under its own scoped test id', () => {
    render(<SessionGroupHeader label="Yesterday" />);
    const header = screen.getByTestId('sessions-group-header-Yesterday');
    expect(header.textContent).toContain('Yesterday');
  });
});

describe('SessionGroupHeader — pin glyph only for the Pinned label', () => {
  it('shows the pin glyph when label is "Pinned"', () => {
    render(<SessionGroupHeader label="Pinned" />);
    expect(screen.getByTestId('sessions-group-pin-glyph')).toBeTruthy();
  });

  it('does not show the pin glyph for a non-Pinned label', () => {
    render(<SessionGroupHeader label="Today" />);
    expect(screen.queryByTestId('sessions-group-pin-glyph')).toBeNull();
  });
});
