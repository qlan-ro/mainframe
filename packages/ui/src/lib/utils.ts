import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// `focus-line*` (globals.css) set the whole outline, so a later `outline-none`
// on the same variant must drop them, and the other way round.
const twMerge = extendTailwindMerge<'focus-line'>({
  extend: {
    classGroups: { 'focus-line': [{ 'focus-line': ['', 'inset'] }] },
    conflictingClassGroups: {
      'focus-line': ['outline-style', 'outline-w', 'outline-offset', 'outline-color'],
      'outline-style': ['focus-line'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
