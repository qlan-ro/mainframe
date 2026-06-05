/**
 * Barrel re-export for the shared tool-card infrastructure.
 *
 * Public API — per-family card agents import from this path.
 */

// ── Pure result logic ────────────────────────────────────────────────────────
export type { TruncatedResult, ResolvedResult } from './result';
export { isStructuredResult, isTruncatedResult, stripErrorXml, resolveResultText } from './result';

// ── Diff math + rendering ────────────────────────────────────────────────────
export { countDiffStats, reconstructFromHunks, computeFallbackHunks } from './diff';
export { DiffFromPatch, DiffFallback } from './diff';

// ── Status chrome ────────────────────────────────────────────────────────────
export { StatusDot, ErrorDot, cardStyle, shortFilename, ClickableFilePath } from './chrome';

// ── Card shell ───────────────────────────────────────────────────────────────
export type { CollapsibleCardShellProps, FamilyTileProps, ErrorBodyProps } from './card-shell';
export { CollapsibleCardShell, FamilyTile, ErrorBody } from './card-shell';
