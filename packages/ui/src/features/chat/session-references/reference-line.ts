/**
 * reference-line — compose and parse `Referenced session @session[label]: <path>`
 * lines, and find `@session[label]` tokens inside a composition. The line syntax
 * and its stripper live in `features/chat/markers/message-markers.ts`.
 */
import { SESSION_REFERENCE_LINE_RE } from '../markers/message-markers';

/** `@session[label]` token, only when preceded by whitespace or string start (the `MENTION_RE` bug pattern). */
const SESSION_TOKEN_RE = /(?:^|(?<=\s))@session\[([^\]\n]*)\]/g;

export function composeReferenceLines(refs: readonly { label: string; path: string }[]): string {
  return refs.map((r) => `Referenced session @session[${r.label}]: ${r.path}`).join('\n');
}

export function parseReferenceLine(line: string): { label: string; path: string } | null {
  const match = SESSION_REFERENCE_LINE_RE.exec(line);
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
