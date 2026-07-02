import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpotlightRowView } from '../SpotlightRow';
import type { SpotlightRow } from '../use-spotlight-results';

const cmdRow: SpotlightRow = {
  type: 'command',
  id: 'review',
  testid: 'search-palette-command-row-review',
  title: 'Review changes…',
  hint: '⌘⇧R',
  run: vi.fn(),
};

describe('SpotlightRowView', () => {
  it('renders the testid, title and a kbd chip per hint glyph', () => {
    render(<SpotlightRowView row={cmdRow} isActive rowRef={() => {}} onSelect={() => {}} />);
    const el = screen.getByTestId('search-palette-command-row-review');
    expect(el).toBeTruthy();
    expect(screen.getByText('Review changes…')).toBeTruthy();
    // "⌘⇧R" → 3 kbd chips
    expect(el.querySelectorAll('kbd')).toHaveLength(3);
  });

  it('renders a status badge for change rows', () => {
    const chg: SpotlightRow = {
      type: 'change',
      id: 'src/a.ts',
      testid: 'search-palette-change-row-src/a.ts',
      title: 'a.ts',
      sub: 'src',
      status: 'M',
      run: vi.fn(),
    };
    render(<SpotlightRowView row={chg} isActive={false} rowRef={() => {}} onSelect={() => {}} />);
    expect(screen.getByText('M')).toBeTruthy();
  });

  it('calls onSelect with the row on click', async () => {
    const onSelect = vi.fn();
    render(<SpotlightRowView row={cmdRow} isActive={false} rowRef={() => {}} onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId('search-palette-command-row-review'));
    expect(onSelect).toHaveBeenCalledWith(cmdRow);
  });

  it('renders a distinct icon per command id instead of one generic glyph for all', () => {
    const settingsRow: SpotlightRow = { ...cmdRow, id: 'settings', testid: 'search-palette-command-row-settings' };
    const { container: reviewContainer } = render(
      <SpotlightRowView row={cmdRow} isActive={false} rowRef={() => {}} onSelect={() => {}} />,
    );
    const { container: settingsContainer } = render(
      <SpotlightRowView row={settingsRow} isActive={false} rowRef={() => {}} onSelect={() => {}} />,
    );
    const reviewIconClass = reviewContainer.querySelector('svg')?.getAttribute('class');
    const settingsIconClass = settingsContainer.querySelector('svg')?.getAttribute('class');
    // Different lucide components render distinct default child paths — the reliable
    // cross-icon signal is the rendered SVG's innerHTML (path/circle data differs).
    expect(reviewContainer.querySelector('svg')?.innerHTML).not.toBe(settingsContainer.querySelector('svg')?.innerHTML);
    expect(reviewIconClass).toBeTruthy();
    expect(settingsIconClass).toBeTruthy();
  });

  it('renders a file-type-specific icon for file rows (not the same generic icon for every extension)', () => {
    const tsRow: SpotlightRow = {
      type: 'file',
      id: 'src/a.ts',
      testid: 'search-palette-file-row-src/a.ts',
      title: 'a.ts',
      run: vi.fn(),
    };
    const mdRow: SpotlightRow = {
      type: 'file',
      id: 'README.md',
      testid: 'search-palette-file-row-README.md',
      title: 'README.md',
      run: vi.fn(),
    };
    const { container: tsContainer } = render(
      <SpotlightRowView row={tsRow} isActive={false} rowRef={() => {}} onSelect={() => {}} />,
    );
    const { container: mdContainer } = render(
      <SpotlightRowView row={mdRow} isActive={false} rowRef={() => {}} onSelect={() => {}} />,
    );
    expect(tsContainer.querySelector('svg')?.innerHTML).not.toBe(mdContainer.querySelector('svg')?.innerHTML);
  });

  it('tints the symbol-row icon color per symbol kind tag', () => {
    const fnRow: SpotlightRow = {
      type: 'symbol',
      id: 'a.ts:1',
      testid: 'search-palette-symbol-row-a',
      title: 'foo',
      tag: 'fn',
      run: vi.fn(),
    };
    const constRow: SpotlightRow = { ...fnRow, id: 'a.ts:2', testid: 'search-palette-symbol-row-b', tag: 'const' };
    const { container: fnContainer } = render(
      <SpotlightRowView row={fnRow} isActive={false} rowRef={() => {}} onSelect={() => {}} />,
    );
    const { container: constContainer } = render(
      <SpotlightRowView row={constRow} isActive={false} rowRef={() => {}} onSelect={() => {}} />,
    );
    const fnClass = fnContainer.querySelector('svg')?.getAttribute('class');
    const constClass = constContainer.querySelector('svg')?.getAttribute('class');
    expect(fnClass).not.toBe(constClass);
  });
});
