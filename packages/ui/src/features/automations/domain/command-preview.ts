/**
 * Thin re-export — moved to `@qlan-ro/mainframe-types` in Phase 6 (see
 * `domain/tokens.ts`'s header comment for why). `command-preview.test.ts`
 * stays in this package (fixture-6-dependent, same rationale as `validate.ts`).
 */
export type { CommandPreviewWarning, CommandPreviewResult } from '@qlan-ro/mainframe-types';
export { buildCommandPreview } from '@qlan-ro/mainframe-types';
