/**
 * What a recommendation's `command` actually is — something you run, or a
 * file's contents you paste — and the footer copy that says so.
 *
 * The kind is a property of the recommendation, not of its category: `skills`
 * carries both `npx skills add` commands and SKILL.md scaffolds, so any
 * per-category table misdescribes one of them. `targetPath` is populated
 * exactly when the payload is a file's contents, which makes it the
 * authoritative signal; a payload with no destination file is one you run.
 */
import type { AutomationRecommendation } from '@qlan-ro/mainframe-types';

type PayloadKind = 'file' | 'claude-code' | 'shell';

const FOOTER_TEXT: Record<PayloadKind, string> = {
  file: 'Read-only — nothing is written until you paste it into your project.',
  'claude-code': 'Read-only — nothing runs until you paste it into Claude Code.',
  shell: 'Read-only — nothing runs until you paste it in your terminal.',
};

/** A tab whose rows disagree can only promise the part they share: copying alone does nothing. */
const MIXED_FOOTER_TEXT = 'Read-only — nothing is applied until you paste it.';

function payloadKind(rec: AutomationRecommendation): PayloadKind {
  if (rec.targetPath) return 'file';
  return rec.category === 'plugins' ? 'claude-code' : 'shell';
}

export function payloadFooterText(rows: readonly AutomationRecommendation[]): string {
  const first = rows[0];
  if (!first) return MIXED_FOOTER_TEXT;
  const kind = payloadKind(first);
  return rows.every((rec) => payloadKind(rec) === kind) ? FOOTER_TEXT[kind] : MIXED_FOOTER_TEXT;
}
