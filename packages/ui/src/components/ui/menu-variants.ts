import { cva } from 'class-variance-authority';

/** Canonical inner padding for every popover/menu *Content surface (prototype PopCard pad=5). */
export const MENU_CONTENT_PADDING = 'p-[5px]';

/**
 * Single source of truth for a menu row's geometry + typography + icon size.
 * The shadcn Item primitives (DropdownMenu/ContextMenu) and the Popover-side
 * Menu* components both compose this, then append their substrate-specific
 * highlight states (Radix focus/data-[highlighted] for menus, hover for popovers).
 * A trailing icon keeps its own `size-*` class because of the :not([class*='size-']) guard.
 */
export const menuItemVariants = cva(
  [
    'flex items-center gap-[9px] rounded-sm px-[8px] py-[7px]',
    'text-label outline-none transition-colors',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[13px]",
    // Default icon color is the muted tertiary text token (design T.text3), not the
    // darker T.text2-mapped --muted-foreground — see design-parity finding 10.2.
    "[&_svg:not([class*='text-'])]:text-mf-text-3",
  ],
  {
    variants: {
      tone: {
        default: 'text-foreground',
        muted: 'text-muted-foreground',
        destructive: 'text-destructive [&_svg]:text-destructive',
      },
    },
    defaultVariants: { tone: 'default' },
  },
);
