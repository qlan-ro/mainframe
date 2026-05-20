import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SelectorBreadcrumb } from '../SelectorBreadcrumb.js';

describe('SelectorBreadcrumb', () => {
  it('renders nothing when path is empty', () => {
    const { container } = render(<SelectorBreadcrumb path="" />);
    expect(container.firstChild).toBeNull();
  });

  it('marks only the last segment as primary', () => {
    const { getAllByTestId } = render(<SelectorBreadcrumb path="body > main.container > section.hero > button.go" />);
    const crumbs = getAllByTestId('selector-crumb');
    expect(crumbs.map((c) => c.textContent)).toEqual(['body', 'main.container', 'section.hero', 'button.go']);
    for (const c of crumbs.slice(0, -1)) {
      expect(c.dataset.crumb).toBe('ancestor');
    }
    expect(crumbs.at(-1)!.dataset.crumb).toBe('target');
  });

  it('keeps chevron clip-path on every segment except the first', () => {
    const { getAllByTestId } = render(<SelectorBreadcrumb path="a > b > c" />);
    const crumbs = getAllByTestId('selector-crumb');
    expect(crumbs[0]!.getAttribute('style')).not.toContain('8px 50%');
    expect(crumbs[1]!.getAttribute('style')).toContain('8px 50%');
    expect(crumbs[2]!.getAttribute('style')).toContain('8px 50%');
  });
});
