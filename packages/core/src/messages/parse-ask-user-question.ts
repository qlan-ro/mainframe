import type { AskUserQuestionAnswer } from '@qlan-ro/mainframe-types';

const PREFIX = 'User has answered your questions: ';
const SUFFIX = ". You can now continue with the user's answers in mind.";
const PAIR = /"([^"]*)"="([^"]*)"/g;

export function parseAskUserQuestionResult(content: string): AskUserQuestionAnswer[] {
  if (typeof content !== 'string' || !content.startsWith(PREFIX)) return [];
  let body = content.slice(PREFIX.length);
  if (body.endsWith(SUFFIX)) body = body.slice(0, -SUFFIX.length);

  const matches: { q: string; a: string; start: number; end: number }[] = [];
  PAIR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PAIR.exec(body)) !== null) {
    matches.push({ q: m[1] ?? '', a: m[2] ?? '', start: m.index, end: PAIR.lastIndex });
  }
  if (matches.length === 0) return [];

  const out: AskUserQuestionAnswer[] = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]!;
    const next = matches[i + 1];
    // tail = text between this pair's closing quote and the start of the next pair (or end of body)
    const tail = body.slice(cur.end, next ? next.start : body.length);

    const previewMatch = tail.match(/selected preview:\r?\n([\s\S]*?)(?: user notes: |$)/);
    const notesMatch = tail.match(/user notes: ([\s\S]*?)\s*,?\s*$/);

    const entry: AskUserQuestionAnswer = {
      question: cur.q,
      answer: cur.a
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    };
    if (entry.answer.length === 0) entry.answer = [cur.a];
    const preview = previewMatch?.[1]?.trim();
    const notes = notesMatch?.[1]?.trim();
    if (preview) entry.preview = preview;
    if (notes) entry.notes = notes;
    out.push(entry);
  }
  return out;
}
