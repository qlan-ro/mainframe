/** Pure per-viewer status-string formatters. Separator: ' · ' (space-middledot-space). */

/**
 * Format bytes as KB under 1 MB, or MB at >= 1 MB.
 * KB: one decimal place, trailing `.0` stripped (e.g. 248.0 KB → '248 KB', 0.4 KB → '0.4 KB').
 * MB: always one decimal (e.g. 1.2 MB).
 */
export function formatBytes(bytes: number): string {
  const KB = 1024;
  const MB = 1024 * 1024;
  if (bytes < MB) {
    const kb = (bytes / KB).toFixed(1);
    return `${kb.endsWith('.0') ? kb.slice(0, -2) : kb} KB`;
  }
  return `${(bytes / MB).toFixed(1)} MB`;
}

export interface ImageStatusArgs {
  ext: string;
  w: number;
  h: number;
  bytes: number;
}

/** e.g. 'PNG · 1840×1024 · 248 KB' — ext uppercased; × is U+00D7 */
export function formatImageStatus({ ext, w, h, bytes }: ImageStatusArgs): string {
  return `${ext.toUpperCase()} · ${w}×${h} · ${formatBytes(bytes)}`;
}

export interface CsvStatusArgs {
  rows: number;
  cols: number;
}

/** e.g. 'CSV · UTF-8 · 12 rows · 4 cols' */
export function formatCsvStatus({ rows, cols }: CsvStatusArgs): string {
  return `CSV · UTF-8 · ${rows} rows · ${cols} cols`;
}

export interface MarkdownStatusArgs {
  words: number;
  lines: number;
}

/** e.g. 'Markdown · 320 words · 88 lines' */
export function formatMarkdownStatus({ words, lines }: MarkdownStatusArgs): string {
  return `Markdown · ${words} words · ${lines} lines`;
}

export interface PdfStatusArgs {
  pages: number;
  bytes: number;
}

/** e.g. 'PDF · 5 pages · 1.2 MB' */
export function formatPdfStatus({ pages, bytes }: PdfStatusArgs): string {
  return `PDF · ${pages} pages · ${formatBytes(bytes)}`;
}

export interface SvgStatusArgs {
  viewBox: string;
  w: number;
  h: number;
  bytes: number;
}

/** e.g. 'SVG · viewBox 0 0 96 96 · 96×96 · 0.4 KB' — × is U+00D7 */
export function formatSvgStatus({ viewBox, w, h, bytes }: SvgStatusArgs): string {
  return `SVG · viewBox ${viewBox} · ${w}×${h} · ${formatBytes(bytes)}`;
}
