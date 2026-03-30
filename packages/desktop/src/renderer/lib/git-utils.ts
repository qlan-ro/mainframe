/**
 * All git porcelain conflict status codes.
 * See: https://git-scm.com/docs/git-status#_short_format
 */
const CONFLICT_STATUSES = new Set(['UU', 'AA', 'DD', 'AU', 'UA', 'UD', 'DU']);

export function isConflictStatus(status: string): boolean {
  return CONFLICT_STATUSES.has(status);
}
