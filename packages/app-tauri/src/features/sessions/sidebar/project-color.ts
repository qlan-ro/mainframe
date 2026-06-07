/**
 * project-color — deterministic per-project identity color.
 *
 * The artboard (02-chrome SessionRowDense) tints the "All"-view project chip by a
 * per-project color (dot + text + 10%-alpha background). Our `Project` type has no
 * color field, so we derive a stable one from the projectId: hash → index into a
 * curated 10-hue oklch palette (the same canonical hues as the tag swatches in
 * tag-colors.ts, so the sidebar shares one visual language).
 *
 * Authored as inline `style` colors, not Tailwind utilities: globals.css defines
 * no per-project token, and Tailwind silently drops unknown utilities (MEMORY
 * Tailwind trap). Callers apply the value via inline style / color-mix.
 */

/** Curated identity hues — mirrors the canonical tag oklch values (tag-colors.ts). */
const PROJECT_PALETTE: readonly string[] = [
  'oklch(0.65 0.18 250)', // blue
  'oklch(0.65 0.22 25)', // red
  'oklch(0.65 0.22 305)', // purple
  'oklch(0.62 0.20 285)', // violet
  'oklch(0.78 0.16 75)', // amber
  'oklch(0.70 0.15 185)', // teal
  'oklch(0.75 0.13 215)', // cyan
  'oklch(0.72 0.19 150)', // green
  'oklch(0.72 0.18 350)', // pink
  'oklch(0.72 0.18 50)', // orange
];

/**
 * djb2 string hash → unsigned 32-bit. Stable across runs/platforms (no Math.random,
 * no Date) so a project keeps the same color for its whole life.
 */
function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

/** Deterministic identity color (oklch string) for a project id. */
export function projectColor(projectId: string): string {
  const index = hashString(projectId) % PROJECT_PALETTE.length;
  // Safe-by-construction: index is always within bounds of a non-empty palette.
  return PROJECT_PALETTE[index] as string;
}
