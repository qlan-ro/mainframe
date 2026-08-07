/**
 * review-scope-view — the pure half of the review modal's change-scope switcher.
 *
 * The three scopes report different fidelities (see `use-working-changes`), so
 * the header shows a different set of facts for each. That decision is here
 * rather than in the header's JSX: `session` and `branch` have no per-file stat,
 * and rendering `+0 −0` for them would claim there is nothing to review.
 */
import type { ChangeScope } from './use-working-changes';

export interface ScopeOption {
  id: ChangeScope;
  label: string;
}

/** Narrowest to widest, left to right. */
export const SCOPE_OPTIONS: readonly ScopeOption[] = [
  { id: 'session', label: 'Session' },
  { id: 'uncommitted', label: 'Uncommitted' },
  { id: 'branch', label: 'Branch' },
];

/**
 * The panel's Changes row counts uncommitted work, so the modal it opens has to
 * land on the scope those numbers describe.
 */
export const DEFAULT_SCOPE: ChangeScope = 'uncommitted';

export interface ScopeHeaderSource {
  branch: string | null;
  baseBranch: string | null;
  mergeBase: string | null;
}

export interface ScopeHeaderView {
  /** Only `uncommitted` carries a working stat, so only it can total anything. */
  showTotals: boolean;
  /** `branch` only, and only once both ends of the comparison are known. */
  compareLine: string | null;
}

const SHORT_SHA = 7;

function compareLine(scope: ChangeScope, { branch, baseBranch, mergeBase }: ScopeHeaderSource): string | null {
  if (scope !== 'branch' || !branch || !baseBranch) return null;
  const base = mergeBase ? ` · ${mergeBase.slice(0, SHORT_SHA)}` : '';
  return `${branch} ↔ ${baseBranch}${base}`;
}

export function scopeHeaderView(scope: ChangeScope, source: ScopeHeaderSource): ScopeHeaderView {
  return { showTotals: scope === 'uncommitted', compareLine: compareLine(scope, source) };
}
