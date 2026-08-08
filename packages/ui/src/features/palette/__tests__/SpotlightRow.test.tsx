import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Command } from '@/components/ui/command';
import { SpotlightRowView } from '../SpotlightRow';
import type { SpotlightRow } from '@/features/palette/use-spotlight-results';

const cmdRow: SpotlightRow = {
  type: 'command',
  id: 'review',
  testid: 'search-palette-command-row-review',
  title: 'Review changes…',
  hint: '⌘⇧R',
  run: vi.fn(),
};

/** CommandItem needs the cmdk root's context. */
function renderRow(row: SpotlightRow, onSelect: (row: SpotlightRow) => void = () => {}) {
  return render(
    <Command shouldFilter={false}>
      <SpotlightRowView row={row} onSelect={onSelect} />
    </Command>,
  );
}

describe('SpotlightRowView', () => {
  it('renders the testid, title and the shortcut hint', () => {
    renderRow(cmdRow);
    const el = screen.getByTestId('search-palette-command-row-review');
    expect(el).toBeTruthy();
    expect(screen.getByText('Review changes…')).toBeTruthy();
    expect(screen.getByText('⌘⇧R')).toBeTruthy();
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
    renderRow(chg);
    expect(screen.getByText('M')).toBeTruthy();
  });

  it('calls onSelect with the row on click', async () => {
    const onSelect = vi.fn();
    renderRow(cmdRow, onSelect);
    await userEvent.click(screen.getByTestId('search-palette-command-row-review'));
    expect(onSelect).toHaveBeenCalledWith(cmdRow);
  });

  it('renders a distinct icon per command id instead of one generic glyph for all', () => {
    const settingsRow: SpotlightRow = { ...cmdRow, id: 'settings', testid: 'search-palette-command-row-settings' };
    const { container: reviewContainer } = renderRow(cmdRow);
    const { container: settingsContainer } = renderRow(settingsRow);
    // Different lucide components render distinct default child paths — the reliable
    // cross-icon signal is the rendered SVG's innerHTML (path/circle data differs).
    expect(reviewContainer.querySelector('svg')?.innerHTML).not.toBe(settingsContainer.querySelector('svg')?.innerHTML);
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
    const { container: tsContainer } = renderRow(tsRow);
    const { container: mdContainer } = renderRow(mdRow);
    expect(tsContainer.querySelector('svg')?.innerHTML).not.toBe(mdContainer.querySelector('svg')?.innerHTML);
  });

  it('renders the workspace command icon solid (fill=currentColor) to match the design glyph play.fill', () => {
    const row: SpotlightRow = { ...cmdRow, id: 'workspace', testid: 'search-palette-command-row-workspace' };
    renderRow(row);
    const svg = screen.getByTestId('search-palette-command-row-workspace').querySelector('svg');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
  });
});
