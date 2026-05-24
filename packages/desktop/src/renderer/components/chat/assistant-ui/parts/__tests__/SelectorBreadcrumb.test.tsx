import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SelectorBreadcrumb } from '../SelectorBreadcrumb.js';

describe('SelectorBreadcrumb', () => {
  it('renders nothing when path is empty', () => {
    const { container } = render(<SelectorBreadcrumb path="" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all segments when path has ≤ 3 segments, last is primary', () => {
    const { getAllByTestId } = render(<SelectorBreadcrumb path="body > main.container > button.go" />);
    const crumbs = getAllByTestId('selector-crumb');
    expect(crumbs.map((c) => c.textContent)).toEqual(['body', 'main.container', 'button.go']);
    expect(crumbs[0]!.dataset.crumb).toBe('ancestor');
    expect(crumbs[1]!.dataset.crumb).toBe('ancestor');
    expect(crumbs.at(-1)!.dataset.crumb).toBe('target');
  });

  it('collapses deep paths to leading ellipsis + last 3 segments', () => {
    const path = 'body > main.container > section.hero > div.card > button.go';
    const { getAllByTestId, container } = render(<SelectorBreadcrumb path={path} />);
    const crumbs = getAllByTestId('selector-crumb');
    expect(crumbs.map((c) => c.textContent)).toEqual(['…', 'section.hero', 'div.card', 'button.go']);
    expect(crumbs[0]!.dataset.crumb).toBe('ancestor');
    expect(crumbs.at(-1)!.dataset.crumb).toBe('target');
    // Full untruncated path remains in the wrapper's title for hover discoverability
    expect(container.querySelector('[title]')!.getAttribute('title')).toBe(path);
  });

  it('keeps chevron clip-path on every segment except the first', () => {
    const { getAllByTestId } = render(<SelectorBreadcrumb path="a > b > c" />);
    const crumbs = getAllByTestId('selector-crumb');
    expect(crumbs[0]!.getAttribute('style')).not.toContain('8px 50%');
    expect(crumbs[1]!.getAttribute('style')).toContain('8px 50%');
    expect(crumbs[2]!.getAttribute('style')).toContain('8px 50%');
  });
});
