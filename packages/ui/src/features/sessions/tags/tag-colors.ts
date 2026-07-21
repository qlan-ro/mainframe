/**
 * Tag color → CSS color value map.
 *
 * app-tauri's globals.css does NOT define --mf-tag-* tokens (desktop's
 * index.css does, but that's a separate stylesheet). Authoring
 * `bg-mf-tag-${color}` here would silently render nothing — Tailwind drops
 * unknown utilities, and the underlying CSS var is absent (MEMORY Tailwind
 * trap). So we apply the swatch color via an inline `style` instead, with the
 * canonical oklch values mirrored from desktop's index.css for visual parity.
 */
import type { CSSProperties } from 'react';
import type { TagColor } from '@qlan-ro/mainframe-types';

const TAG_COLOR_VALUES: Record<TagColor, string> = {
  blue: 'oklch(0.65 0.18 250)',
  red: 'oklch(0.65 0.22 25)',
  purple: 'oklch(0.65 0.22 305)',
  violet: 'oklch(0.62 0.20 285)',
  amber: 'oklch(0.78 0.16 75)',
  teal: 'oklch(0.70 0.15 185)',
  cyan: 'oklch(0.75 0.13 215)',
  green: 'oklch(0.72 0.19 150)',
  pink: 'oklch(0.72 0.18 350)',
  orange: 'oklch(0.72 0.18 50)',
};

/** Returns the CSS color string for a tag color (safe for inline `style`). */
export function tagColorValue(color: TagColor): string {
  return TAG_COLOR_VALUES[color];
}

/** Convenience: an inline style object painting a swatch in the tag color. */
export function TAG_DOT_STYLE(color: TagColor): CSSProperties {
  return { backgroundColor: tagColorValue(color) };
}

/** A soft-tinted chip/pill in the tag's own color (background tint + matching text). */
export function TAG_CHIP_STYLE(color: TagColor): CSSProperties {
  const value = tagColorValue(color);
  return { backgroundColor: `color-mix(in oklch, ${value} 18%, transparent)`, color: value };
}

/** Selected-state variant of TAG_CHIP_STYLE: a solid fill in the tag's own
 *  color with white text, for toggleable filter pills (e.g. TagFilterBar). */
export function TAG_CHIP_ACTIVE_STYLE(color: TagColor): CSSProperties {
  return { backgroundColor: tagColorValue(color), color: 'white' };
}
