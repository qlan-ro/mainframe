/**
 * Barrel re-export for the shared tool-card infrastructure.
 *
 * Public API — per-family card agents import from this path.
 */

// ── Pure result logic ────────────────────────────────────────────────────────
export type { TruncatedResult, ToolCardProps } from './result';
export { isStructuredResult, isTruncatedResult, stripErrorXml } from './result';

// ── Diff math + rendering ────────────────────────────────────────────────────
export { countDiffStats, reconstructFromHunks, computeFallbackHunks } from './diff';
export { DiffFromPatch, DiffFallback } from './diff';

// ── Status chrome ────────────────────────────────────────────────────────────
export { StatusDot, ErrorDot, borderColor, cardStyle, shortFilename, ClickableFilePath } from './chrome';
