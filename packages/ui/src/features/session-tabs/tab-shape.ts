/**
 * The title-bar tab shape: one 32px pill shared by the session tabs and the
 * workspace tabs (W2). Only the look and the keyboard model live here; what a
 * tab means stays with its strip.
 *
 * The selected pill is the content colour with a hairline and a soft shadow;
 * the others are quiet ink that tints on hover.
 */
import type { CSSProperties, KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

export function tabShape(selected: boolean, className?: string): string {
  return cn(
    'group/tab relative flex h-8 cursor-pointer items-center rounded-[9px] text-sm select-none focus-visible:focus-line-inset',
    selected
      ? 'bg-background text-foreground shadow-xs inset-ring inset-ring-border'
      : 'text-foreground/80 hover:bg-(--tab-hover) hover:text-foreground',
    className,
  );
}

/**
 * The hover tint as an OPAQUE colour mixed over whatever the pill sits on, so a
 * control overlaying the title's tail can paint exactly the pill's own ground.
 */
export function tabHoverStyle(ground: '--sidebar' | '--popover'): CSSProperties {
  return { '--tab-hover': `color-mix(in srgb, var(--foreground) 5%, var(${ground}))` } as CSSProperties;
}

/** A close control overlaying the end of the title: out of flow, so a hidden ✕ takes no room. */
export const TAB_CLOSE_OVERLAY =
  'absolute inset-y-0 right-1 flex items-center before:pointer-events-none before:absolute before:inset-y-0 before:right-full before:w-4 before:bg-linear-to-r before:from-transparent';

/** A 24px close button: small enough for the pill, large enough to hit. */
export const TAB_CLOSE_BUTTON = 'size-6 rounded-sm text-muted-foreground hover:bg-foreground/8 hover:text-foreground';

/** Marks the button `Delete` or `Backspace` presses on a focused tab. */
export const TAB_CLOSE_ATTR = { 'data-tab-close': '' } as const;

/**
 * Keyboard for a `role="tablist"`: arrows, Home and End move focus between tabs,
 * Enter and Space select, Delete or Backspace closes and moves focus to the tab
 * that takes its place, or after the last one to `afterLast` (by default the strip's
 * `+`). Ignores keys from controls nested in a tab, which handle their own.
 */
export function onTabListKeyDown(event: KeyboardEvent<HTMLElement>, afterLast?: () => HTMLElement | null): void {
  const tab = event.target as HTMLElement;
  if (tab.getAttribute('role') !== 'tab') return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
  const index = tabs.indexOf(tab);
  const focusable: Partial<Record<string, HTMLElement | undefined>> = {
    ArrowLeft: tabs[index - 1],
    ArrowRight: tabs[index + 1],
    Home: tabs[0],
    End: tabs[tabs.length - 1],
  };
  if (event.key in focusable) {
    event.preventDefault();
    focusable[event.key]?.focus();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    tab.click();
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    // Before the close: the closing tab takes focus with it, and the neighbour survives the render.
    const next = tabs[index + 1] ?? tabs[index - 1] ?? afterLast?.() ?? event.currentTarget.nextElementSibling;
    if (next instanceof HTMLElement) next.focus();
    tab.querySelector<HTMLElement>('[data-tab-close]')?.click();
  }
}
