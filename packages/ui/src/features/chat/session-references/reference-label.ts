/**
 * reference-label — turn a session's title into a stable, disambiguated
 * `@session[label]` reference label.
 *
 * Sanitizing (rather than escaping) the title beats escaping: an escaped title
 * still carries markdown/regex-hostile characters into a `[...]` token that a
 * later parser must unescape symmetrically, while a sanitized label is safe to
 * embed and safe to re-parse with the same simple bracket regex everywhere
 * (spec decision 20).
 */

export const UNTITLED_SESSION_LABEL = 'Untitled session';

/** Everything kept as-is: letters, digits, spaces, and a small punctuation allowlist. */
const KEEP_RE = /[\p{L}\p{N} …,;!?'"()-]/u;

export function sanitizeReferenceLabel(title: string | null | undefined): string {
  if (!title) return UNTITLED_SESSION_LABEL;
  const kept = Array.from(title, (ch) => (KEEP_RE.test(ch) ? ch : ' ')).join('');
  const collapsed = kept.replace(/\s+/g, ' ').trim();
  return collapsed.length > 0 ? collapsed : UNTITLED_SESSION_LABEL;
}

export function nextFreeLabel(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

export function disambiguateLabels(entries: readonly { chatId: string; label: string }[]): Map<string, string> {
  const taken = new Set<string>();
  const result = new Map<string, string>();
  for (const entry of entries) {
    const label = nextFreeLabel(entry.label, taken);
    taken.add(label);
    result.set(entry.chatId, label);
  }
  return result;
}

export function labelSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
