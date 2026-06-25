/**
 * File-extension accent colors for attachment pills (design UMFileThumb).
 *
 * Values are oklch strings (NOT hex) applied via inline `style`, mirroring the
 * tag-colors.ts pattern: globals.css defines no per-extension token, and the
 * design-token-audit forbids raw hex/rgb literals in production UI. The exact
 * shade is decorative (quick file-type recognition), not load-bearing.
 */
interface ExtMeta {
  color: string;
  label: string;
}

const EXT_META: Record<string, ExtMeta> = {
  ts: { color: 'oklch(0.54 0.13 254)', label: 'TypeScript' },
  tsx: { color: 'oklch(0.54 0.13 254)', label: 'TypeScript' },
  js: { color: 'oklch(0.70 0.13 88)', label: 'JavaScript' },
  json: { color: 'oklch(0.65 0.12 73)', label: 'JSON' },
  log: { color: 'oklch(0.56 0.01 286)', label: 'Log file' },
  md: { color: 'oklch(0.52 0.17 285)', label: 'Markdown' },
  css: { color: 'oklch(0.60 0.09 180)', label: 'Stylesheet' },
  png: { color: 'oklch(0.60 0.12 160)', label: 'Image' },
};
const FALLBACK_META: ExtMeta = { color: 'oklch(0.56 0.01 286)', label: 'File' };

export interface FileExtMeta extends ExtMeta {
  ext: string;
}

export function fileExtMeta(name: string): FileExtMeta {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  return { ext, ...(EXT_META[ext] ?? FALLBACK_META) };
}

/** A faint tint of the ext color for the tile background (was `${hex}16` ≈ 9%). */
export function extTint(color: string): string {
  return `color-mix(in srgb, ${color} 12%, transparent)`;
}
