/**
 * SessionGroupHeader — behavior tests.
 *
 * SessionGroupHeader is the label header for one time/status section in the
 * sessions list, rendered by SessionListVirtuoso as GroupedVirtuoso's
 * `groupContent`. It replaced the retired SessionGroup component (which owned
 * both the header AND the item list). Behaviors covered:
 *  1. Renders the group label text in `sessions-group-header-<label>`.
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
