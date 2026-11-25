import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The named sizes and shadows of globals.css. tailwind-merge knows only the stock
// names and takes any other `text-*` for a colour, so without these a size would
// drop the colour it stands beside (`cn('text-muted-foreground', 'text-meta')`).
const TEXT_SIZES = [
  'tile',
  'meta',
  'title',
  'transcript',
  'composer-input',
  'body',
  'control',
  'small',
  'label',
  'caption',
  'mono',
  'headline',
];
const SHADOWS = ['card', 'tooltip', 'mf-pop'];

// `focus-line*` (globals.css) set the whole outline, so a later `outline-none`
// on the same variant must drop them, and the other way round.
const twMerge = extendTailwindMerge<'focus-line'>({
  extend: {
    theme: { text: TEXT_SIZES, shadow: SHADOWS, radius: ['tile'] },
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
