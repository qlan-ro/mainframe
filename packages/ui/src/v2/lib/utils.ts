import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge doesn't know our named font sizes are font sizes, so it lumps
 * them into the same `text-*` conflict group as colours and drops the size
 * whenever a colour follows it — `text-body text-muted-foreground` collapses to
 * just the colour and renders at the inherited size. Registering the names keeps
 * size and colour independent.
 *
 * This list is the v2 scale (6 rungs), not the shipped one: `micro` and `label`
 * are gone. Keep it in step with the `--text-*` rungs in styles/globals.css.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['caption', 'body', 'heading', 'title', 'display', 'hero'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
