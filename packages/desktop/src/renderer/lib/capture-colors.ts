/**
 * Per-capture color palette. Each capture is identified by a colored badge in
 * the sandbox metadata sidecar and a matching colored caption beneath its
 * thumbnail; the shared color is what visually correlates "this breadcrumb
 * belongs to that thumbnail" when a message carries multiple captures.
 *
 * The palette cycles by index so the first capture is always the same color,
 * the second always the next, etc. — stable and predictable across renders.
 */
export interface CaptureColor {
  /** Tailwind classes for the metadata-sidecar badge (background + border + text). */
  badge: string;
  /** Tailwind text-color class for the thumbnail caption beneath an image. */
  caption: string;
}

const PALETTE: ReadonlyArray<CaptureColor> = [
  { badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30', caption: 'text-amber-300' },
  { badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30', caption: 'text-sky-300' },
  { badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', caption: 'text-emerald-300' },
  { badge: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30', caption: 'text-fuchsia-300' },
  { badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30', caption: 'text-rose-300' },
];

export function captureColor(index: number): CaptureColor {
  return PALETTE[index % PALETTE.length]!;
}
