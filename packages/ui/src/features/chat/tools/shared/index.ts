/**
 * Barrel re-export for the shared tool-card infrastructure.
 *
 * Public API — per-family card agents import from this path.
 */

// ── Pure result logic ────────────────────────────────────────────────────────
export type { TruncatedResult, ResolvedResult } from './result';
export {
  isStructuredResult,
  isTruncatedResult,
  stripErrorXml,
  resolveResultText,
  isErrorResult,
  extractResultContent,
  resultImages,
} from './result';

// ── Diff math ────────────────────────────────────────────────────────────────
export { countDiffStats, reconstructFromHunks, computeFallbackHunks } from './diff-data';

// ── Tool-result image thumbnails ────────────────────────────────────────────
export type { ToolResultImageThumbsProps } from './ToolResultImageThumbs';
export { ToolResultImageThumbs } from './ToolResultImageThumbs';
