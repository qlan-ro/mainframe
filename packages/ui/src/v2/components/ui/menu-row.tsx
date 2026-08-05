/**
 * MenuRow — the dropdown-menu item recipe as a plain button, for menu-shaped
 * panels that are NOT Radix menus. Radix DropdownMenu owns its trigger/portal
 * tree, so a menu rendered inline inside a PopoverContent (the branch popover's
 * side-by-side cards, the launch picker) can't use it; this keeps those rows
 * visually stock without importing radix-ui at a call site.
 */
import * as React from 'react';
import { cn } from '@v2/lib/utils';

export function menuRowClass(opts?: { destructive?: boolean }): string {
  return cn(
    "relative flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden select-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    opts?.destructive
      ? 'text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10 dark:hover:bg-destructive/20 *:[svg]:text-destructive'
      : 'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground',
  );
}

interface MenuRowProps extends React.ComponentProps<'button'> {
  destructive?: boolean;
}

export const MenuRow = React.forwardRef<HTMLButtonElement, MenuRowProps>(
  ({ destructive, className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(menuRowClass({ destructive }), 'disabled:pointer-events-none disabled:opacity-50', className)}
      {...props}
    />
  ),
);
MenuRow.displayName = 'MenuRow';
