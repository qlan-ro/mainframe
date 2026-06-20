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
});
