/**
 * The look of a menu's rows, for popovers that read as menus but hold more than
 * a menu may (DESIGN.md, Menus).
 */
export const MENU_ITEM =
  "flex min-h-7 w-full items-start gap-2.5 rounded-sm px-2.5 py-[7px] text-left text-control font-medium hover:bg-sidebar-accent focus-visible:bg-sidebar-accent focus-visible:focus-line-inset disabled:pointer-events-none disabled:opacity-50 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";

export const MENU_LABEL = 'px-2.5 pt-2 pb-[3px] text-caption/[1.45] font-semibold text-muted-foreground';

export const MENU_SEPARATOR = 'mx-1.5 my-1 h-px shrink-0 bg-border';

/** A row's second line, and a menu's small print. */
export const MENU_DETAIL = 'text-meta/[1.35] font-normal text-muted-foreground';
