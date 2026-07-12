/**
 * Thin re-export — the token model now lives in `@qlan-ro/mainframe-types`
 * (docs/plans/2026-07-12-automations-v2-ui.md "Decision: where pure logic
 * lives"; moved in Phase 6 so the daemon's canonical validation can import
 * the same functions this UI does). Every existing `../domain/tokens` import
 * across the automations feature keeps working unchanged.
 */
export type { TokenValueType, TokenSourceKind, TokenDescriptor } from '@qlan-ro/mainframe-types';
export { builtinTokens, triggerTokens, findStepById, stepLabel, stepProduces, scopeAt } from '@qlan-ro/mainframe-types';
