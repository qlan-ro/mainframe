import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MenuRow, MenuLabel, MenuCheckRow, MenuSearchField, MENU_CONTENT_PADDING, menuItemVariants } from '../menu';

describe('menu vocabulary', () => {
  it('MENU_CONTENT_PADDING is the canonical 5px', () => {
    expect(MENU_CONTENT_PADDING).toBe('p-[5px]');
  });

  it('menuItemVariants encodes the row geometry once', () => {
    const cls = menuItemVariants();
    expect(cls).toContain('gap-[9px]');
    expect(cls).toContain('px-[8px]');
    expect(cls).toContain('py-[7px]');
    expect(cls).toContain('text-label');
    expect(cls).toContain('rounded-sm');
  });

  it('MenuRow renders label + forwards click and testid', () => {
    const onClick = vi.fn();
    render(<MenuRow data-testid="x-row" label="Update all" onClick={onClick} />);
    const row = screen.getByTestId('x-row');
    expect(row).toHaveTextContent('Update all');
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('MenuRow danger applies destructive tone', () => {
    render(<MenuRow data-testid="x-del" label="Delete" danger />);
    expect(screen.getByTestId('x-del').className).toContain('text-destructive');
  });

  it('MenuLabel renders an uppercase eyebrow', () => {
    render(<MenuLabel>Tags</MenuLabel>);
    const el = screen.getByText('Tags');
    expect(el.closest('div')?.className).toContain('uppercase');
    expect(el.closest('div')?.className).toContain('text-micro');
  });

  it('MenuCheckRow reflects checked state', () => {
    render(<MenuCheckRow data-testid="x-chk" checked label="bug" />);
    expect(screen.getByTestId('x-chk')).toHaveAttribute('aria-checked', 'true');
  });

  it('MenuSearchField forwards value changes', () => {
    const onValueChange = vi.fn();
    render(<MenuSearchField data-testid="x-search" value="" onValueChange={onValueChange} placeholder="Find" />);
    fireEvent.change(screen.getByPlaceholderText('Find'), { target: { value: 'a' } });
    expect(onValueChange).toHaveBeenCalledWith('a');
  });
});
