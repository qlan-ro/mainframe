/**
 * session-mention — the composer's spelling of a session reference (`@<label>`)
 * and its translation to the wire spelling (`@session[<label>]`) at send (#240).
 *
 * The draft carries the bare label so the composer reads like its `@file`
 * mentions: the overlay behind the textarea is color-only (see
 * `render-highlights.tsx`), so a token in the draft is shown verbatim and
 * `session[…]` scaffolding would be on screen while typing. The wire body still
 * uses the bracket form — it delimits the spaces in a title, and it is what the
 * message renderer chips and the reference lines key on.
 *
 * Only labels the draft recorded are recognized, so prose that happens to start
 * with `@` is untouched. Longest label first: with both `Foo` and `Foo (2)`
 * recorded, `@Foo (2)` must not rewrite as `@session[Foo] (2)`.
 */

/** A label may not be followed by an alphanumeric — `@Foobar` is not the label `Foo`. */
const LABEL_TAIL_RE = /[\p{L}\p{N}]/u;

export interface SessionMention {
  /** Index of the `@`. */
  start: number;
  /** Index one past the label's last character. */
  end: number;
  label: string;
}

function matchesLabelAt(text: string, at: number, label: string): boolean {
  if (label === '' || !text.startsWith(label, at)) return false;
  const next = text[at + label.length];
  return next === undefined || !LABEL_TAIL_RE.test(next);
}

/** Every plain `@<label>` occurrence in `text`, in order, non-overlapping. */
export function findSessionMentions(text: string, labels: readonly string[]): SessionMention[] {
  const ordered = [...labels].sort((a, b) => b.length - a.length);
  const found: SessionMention[] = [];
  let i = 0;

  while (i < text.length) {
    const atTokenStart = text[i] === '@' && (i === 0 || /\s/.test(text[i - 1]!));
    const label = atTokenStart ? ordered.find((l) => matchesLabelAt(text, i + 1, l)) : undefined;
    if (label === undefined) {
      i += 1;
      continue;
    }
    const end = i + 1 + label.length;
    found.push({ start: i, end, label });
    i = end;
  }

  return found;
}

/** Draft spelling → wire spelling. Already-bracketed tokens pass through untouched. */
export function expandSessionMentions(text: string, labels: readonly string[]): string {
  const mentions = findSessionMentions(text, labels);
  if (mentions.length === 0) return text;

  let out = '';
  let last = 0;
  for (const m of mentions) {
    out += `${text.slice(last, m.start)}@session[${m.label}]`;
    last = m.end;
  }
  return out + text.slice(last);
}
