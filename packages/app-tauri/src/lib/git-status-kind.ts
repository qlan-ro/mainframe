/**
 * Shared porcelain-code → semantic-kind mapper.
 *
 * The daemon emits a trimmed 2-char XY git porcelain code (e.g. 'M', 'A', 'D',
 * '??', 'R', 'C', 'MM', 'AM', 'RM'). This function collapses it to one of four
 * semantic kinds used by both ChangesPanel and the review surfaces.
 *
 * Precedence mirrors ChangesPanel.tsx:10 (existing canonical mapping) with
 * rename/copy added before the add/del/modify checks so that 'RM' → 'renamed'
 * rather than 'modified'.
 */
export type GitStatusKind = 'added' | 'modified' | 'deleted' | 'renamed';

/** Trimmed 2-char XY porcelain code (e.g. 'M', '??', 'MM', 'RM') → semantic kind. */
export function gitStatusKind(code: string): GitStatusKind {
  if (code.includes('R') || code.includes('C')) return 'renamed';
  if (code === '??' || code.includes('A')) return 'added';
  if (code.includes('D')) return 'deleted';
  return 'modified';
}
