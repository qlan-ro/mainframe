/**
 * Thin re-export — moved to `@qlan-ro/mainframe-types` in Phase 6 (see
 * `domain/tokens.ts`'s header comment for why). `validate.test.ts` stays in
 * this package (it depends on `fixtures/fixtures.ts`, which is UI-local
 * plumbing over the canonical JSON fixtures) — see this feature's Phase 6
 * notes for the split rationale.
 */
export type { ValidationIssue } from '@qlan-ro/mainframe-types';
export { validate } from '@qlan-ro/mainframe-types';
