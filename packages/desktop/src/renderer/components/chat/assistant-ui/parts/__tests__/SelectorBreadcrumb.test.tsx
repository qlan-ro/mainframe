import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SelectorBreadcrumb } from '../SelectorBreadcrumb.js';

describe('SelectorBreadcrumb', () => {
  it('renders one chevron segment per path part in order', () => {
    render(<SelectorBreadcrumb path="div.card > h2 > span" />);
    expect(screen.getAllByTestId('selector-crumb').map((s) => s.textContent)).toEqual(['div.card', 'h2', 'span']);
  });
  it('handles a single-part selector', () => {
    render(<SelectorBreadcrumb path="#main" />);
    expect(screen.getAllByTestId('selector-crumb').map((s) => s.textContent)).toEqual(['#main']);
  });
  it('renders nothing for an empty/whitespace path', () => {
    const { container } = render(<SelectorBreadcrumb path="   " />);
    expect(container.querySelectorAll('[data-testid="selector-crumb"]').length).toBe(0);
  });
});
