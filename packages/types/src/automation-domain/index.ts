/**
 * Automations v2 pure domain logic — token scoping, comparators, chip-part
 * helpers, token resolution, plain-language validation, the A1 command
 * preview, and trigger summaries. React-free, I/O-free (docs/plans/
 * 2026-07-12-automations-v2-ui.md "Decision: where pure logic lives");
 * `packages/ui/src/features/automations/domain/*.ts` re-exports these
 * unchanged so existing UI imports keep working.
 */
export * from './tokens.js';
export * from './token-scope.js';
export * from './comparators.js';
export * from './chip-parts.js';
export * from './resolve.js';
export * from './validate.js';
export * from './command-preview.js';
export * from './trigger-summary.js';
