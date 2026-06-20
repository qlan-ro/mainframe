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

/**
 * Split image status for left/right footer slots.
 * left:  'PNG · 1840×1024'
 * right: '248 KB · fit to window' or '248 KB · 100%'
 */
export interface ImageStatusSplit {
  left: string;
  right: string;
}

export function splitImageStatus({
  ext,
  w,
  h,
  bytes,
  zoom,
  fit,
}: ImageStatusArgs & { zoom: number; fit: boolean }): ImageStatusSplit {
  const left = `${ext.toUpperCase()} · ${w}×${h}`;
  const zoomLabel = fit ? 'fit to window' : `${Math.round(zoom * 100)}%`;
  const right = bytes > 0 ? `${formatBytes(bytes)} · ${zoomLabel}` : zoomLabel;
  return { left, right };
}

export interface CsvStatusArgs {
  rows: number;
  cols: number;
}

/** e.g. 'CSV · UTF-8 · 12 rows · 4 cols' */
export function formatCsvStatus({ rows, cols }: CsvStatusArgs): string {
  return `CSV · UTF-8 · ${rows} rows · ${cols} cols`;
}

/**
 * Split CSV status for left/right footer slots.
 * left:  'CSV · UTF-8'
 * right: '12 rows · 4 cols' (or 'N/total rows · M cols' when filtered)
 */
export interface CsvStatusSplit {
  left: string;
  right: string;
}

export function splitCsvStatus({
  rows,
  cols,
  filtered,
  total,
}: CsvStatusArgs & { filtered?: number; total?: number }): CsvStatusSplit {
  const left = 'CSV · UTF-8';
  const rowLabel =
    filtered !== undefined && total !== undefined && filtered !== total
      ? `${filtered}/${total} rows`
      : `${rows} rows`;
  const right = `${rowLabel} · ${cols} cols`;
  return { left, right };
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

/**
 * Split SVG status for left/right footer slots.
 * left:  'SVG · viewBox 0 0 96 96'
 * right: '96×96 · 0.4 KB'
 */
export interface SvgStatusSplit {
  left: string;
  right: string;
}

export function splitSvgStatus({ viewBox, w, h, bytes }: SvgStatusArgs): SvgStatusSplit {
  const left = `SVG · viewBox ${viewBox}`;
  const right = `${w}×${h} · ${formatBytes(bytes)}`;
  return { left, right };
}

/**
 * Split Markdown status for left/right footer slots.
 * left:  'Markdown · UTF-8'
 * right: '320 words · 88 lines'
 */
export interface MarkdownStatusSplit {
  left: string;
  right: string;
}

export function splitMarkdownStatus(words: number, lines: number): MarkdownStatusSplit {
  return { left: 'Markdown · UTF-8', right: `${words} words · ${lines} lines` };
}
