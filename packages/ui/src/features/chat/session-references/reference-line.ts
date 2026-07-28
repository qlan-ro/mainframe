/**
 * reference-line — compose, parse, and strip `Referenced session @session[label]: <path>`
 * lines, and find `@session[label]` tokens inside a composition.
 */

/** `@session[label]` token, only when preceded by whitespace or string start (the `MENTION_RE` bug pattern). */
const SESSION_TOKEN_RE = /(?:^|(?<=\s))@session\[([^\]\n]*)\]/g;

const REFERENCE_LINE_RE = /^Referenced session @session\[([^\]\n]*)\]: (\S.*)$/;

export function composeReferenceLines(refs: readonly { label: string; path: string }[]): string {
  return refs.map((r) => `Referenced session @session[${r.label}]: ${r.path}`).join('\n');
}

export function parseReferenceLine(line: string): { label: string; path: string } | null {
  const match = REFERENCE_LINE_RE.exec(line);
  if (!match) return null;
  return { label: match[1]!, path: match[2]! };
}

export function collectSessionTokenLabels(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(SESSION_TOKEN_RE)) {
    seen.add(match[1]!);
  }
  return Array.from(seen);
}

/** Places the reference block above the body — or below line 1 when the body is a slash command (D1). */
export function prependSessionReferences(body: string, paths: ReadonlyMap<string, string>): string {
  const labels = collectSessionTokenLabels(body).filter((label) => paths.has(label));
  if (labels.length === 0) return body;

  const lines = composeReferenceLines(labels.map((label) => ({ label, path: paths.get(label)! })));

  if (!body.startsWith('/')) return `${lines}\n\n${body}`;
  const nl = body.indexOf('\n');
  // D1: a leading `/` is the CLI's only slash-command signal — keep it on line 1.
  return nl === -1 ? `${body}\n\n${lines}` : `${body.slice(0, nl)}\n\n${lines}${body.slice(nl)}`;
}

/**
 * Removes every block-initial maximal run of reference lines (a run starting at
 * line 0 or preceded by a blank line) plus one adjacent blank line, so two
 * paragraphs that surrounded a run end up separated by exactly one blank line.
 * A matching line preceded by a non-empty line is left alone — that's what
 * makes decision D1's below-the-command layout strippable without also eating
 * unrelated reference-shaped prose.
 */
export function stripReferenceLines(text: string): string {
  const source = text.split('\n');
  const kept: string[] = [];
  let changed = false;
  let i = 0;

  while (i < source.length) {
    const blockInitial = i === 0 || source[i - 1] === '';
    if (blockInitial && REFERENCE_LINE_RE.test(source[i]!)) {
      let end = i;
      while (end < source.length && REFERENCE_LINE_RE.test(source[end]!)) end += 1;
      changed = true;
      if (end < source.length && source[end] === '') {
        end += 1;
      } else if (kept.length > 0 && kept[kept.length - 1] === '') {
        kept.pop();
      }
      i = end;
      continue;
    }
    kept.push(source[i]!);
    i += 1;
  }

  return changed ? kept.join('\n') : text;
}
