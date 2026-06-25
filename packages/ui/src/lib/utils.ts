import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The warm-chrome theme defines a custom font-size scale in globals.css
 * (text-micro/caption/label/body/heading/title/display/hero). tailwind-merge
 * doesn't know these are font sizes, so by default it lumps them into the same
 * `text-*` conflict group as colour utilities and drops the size whenever a
 * `text-<color>` follows it (e.g. `text-label text-muted-foreground` collapsed to
 * just the colour, rendering at the inherited size). Registering the names in the
 * font-size group keeps size and colour independent.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'caption', 'label', 'body', 'heading', 'title', 'display', 'hero'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
