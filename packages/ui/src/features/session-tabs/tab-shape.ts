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
 * The hover tint as an OPAQUE colour mixed over the title bar's ground, so a
 * control overlaying the title's tail can paint exactly the pill's own ground.
 */
export const TAB_HOVER_STYLE = {
  '--tab-hover': 'color-mix(in srgb, var(--foreground) 5%, var(--sidebar))',
} as CSSProperties;

/** A close control overlaying the end of the title: out of flow, so a hidden ✕ takes no room. */
export const TAB_CLOSE_OVERLAY =
  'absolute inset-y-0 right-1 flex items-center before:pointer-events-none before:absolute before:inset-y-0 before:right-full before:w-4 before:bg-linear-to-r before:from-transparent';

/** A 24px close button: small enough for the pill, large enough to hit. */
export const TAB_CLOSE_BUTTON = 'size-6 rounded-sm text-muted-foreground hover:bg-foreground/8 hover:text-foreground';

/** Marks the button `Delete` or `Backspace` presses on a focused tab. */
export const TAB_CLOSE_ATTR = { 'data-tab-close': '' } as const;

/** What a focused tab answers to, for assistive tech: closing by keyboard has no visible hint. */
export const TAB_KEYS_ATTR = { 'aria-keyshortcuts': 'Delete Backspace' } as const;

/**
 * Keyboard for a `role="tablist"`: arrows, Home and End move focus between tabs,
 * Enter and Space select, Delete or Backspace closes and moves focus to the tab
 * that takes its place, or after the last one to `afterLast` (by default the strip's
 * `+`). Ignores keys from controls nested in a tab, which handle their own.
 *
 * Closing can kill a process and never asks, so it takes a deliberate press: one
 * unmodified key, not a held one (focus moves to the neighbour, which the repeat
 * would close too), on a tab whose focus is visible.
 */
export function onTabListKeyDown(event: KeyboardEvent<HTMLElement>, afterLast?: () => HTMLElement | null): void {
  const tab = event.target as HTMLElement;
  if (tab.getAttribute('role') !== 'tab') return;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
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
    if (event.repeat || !tab.matches(':focus-visible')) return;
    // Before the close: the closing tab takes focus with it, and the neighbour survives the render.
    const next = tabs[index + 1] ?? tabs[index - 1] ?? afterLast?.() ?? event.currentTarget.nextElementSibling;
    if (next instanceof HTMLElement) next.focus();
    tab.querySelector<HTMLElement>('[data-tab-close]')?.click();
  }
}

/**
 * For a `role="tablist"`: a mouse press selects a tab without focusing it, so a
 * later stray key cannot reach it. Focus arrives by keyboard only, so a press on
 * another tab also takes keyboard focus off the tab that held it, in either strip: left
 * there, the next Backspace would close a tab the user has moved away from.
 */
export function keepFocusOnTabPress(event: { target: EventTarget; preventDefault: () => void }): void {
  const tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
  if (tab == null) return;
  event.preventDefault();
  const active = document.activeElement;
  const focusedTab = active?.closest('[role="tab"]');
  if (focusedTab != null && focusedTab !== tab && active instanceof HTMLElement) active.blur();
}
