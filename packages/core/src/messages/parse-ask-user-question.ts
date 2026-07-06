import type { AskUserQuestionAnswer } from '@qlan-ro/mainframe-types';

// The CLI's AskUserQuestion result wording varies across versions — match every
// known prefix/suffix variant so answers keep parsing. Older builds emit
// "User has answered your questions: … the user's answers in mind."; newer ones
// emit "Your questions have been answered: … these answers in mind."
const PREFIXES = ['User has answered your questions: ', 'Your questions have been answered: '];
const SUFFIXES = [
  ". You can now continue with the user's answers in mind.",
  '. You can now continue with these answers in mind.',
];
const PAIR = /"([^"]*)"="([^"]*)"/g;

export interface KnownQuestion {
  question: string;
  multiSelect?: boolean;
  options?: { label: string }[];
}

function stripBody(content: string): string | undefined {
  if (typeof content !== 'string') return undefined;
  const prefix = PREFIXES.find((p) => content.startsWith(p));
  if (prefix === undefined) return undefined;
  let body = content.slice(prefix.length);
  const suffix = SUFFIXES.find((s) => body.endsWith(s));
  if (suffix) body = body.slice(0, -suffix.length);
  return body;
}

function splitAnswer(raw: string, multiSelect: boolean | undefined): string[] {
  if (!multiSelect) {
    // Free-text / single-select answers are kept verbatim — they routinely
    // contain commas and quotes (e.g. pasted prose, "Other" text).
    const trimmed = raw.trim();
    return trimmed.length > 0 ? [trimmed] : [raw];
  }
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [raw];
}

function extractPreviewNotes(segment: string): { answer: string; preview?: string; notes?: string } {
  const previewMatch = segment.match(/selected preview:\r?\n([\s\S]*?)(?: user notes: |$)/);
  const notesMatch = segment.match(/user notes: ([\s\S]*?)\s*,?\s*$/);
  const cutAt = segment.search(/ selected preview:| user notes: /);
  let answer = cutAt === -1 ? segment : segment.slice(0, cutAt);
  // Drop the answer's structural closing quote.
  if (answer.endsWith('"')) answer = answer.slice(0, -1);
  const out: { answer: string; preview?: string; notes?: string } = { answer };
  const preview = previewMatch?.[1]?.trim();
  const notes = notesMatch?.[1]?.trim();
  if (preview) out.preview = preview;
  if (notes) out.notes = notes;
  return out;
}

/**
 * Anchored parse: locate each known question by its exact text, then take the
 * answer as everything up to the next known question's marker. Robust to
 * quotes and commas inside both question and answer text.
 */
function parseAnchored(body: string, questions: KnownQuestion[]): AskUserQuestionAnswer[] | undefined {
  const out: AskUserQuestionAnswer[] = [];
  let cursor = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const marker = `"${q.question}"="`;
    const mIdx = body.indexOf(marker, cursor);
    if (mIdx === -1) continue; // unanswered question — omit
    const ansStart = mIdx + marker.length;

    // Boundary: the start of the next answered question's marker, which is
    // preceded by `", ` (this answer's closing quote + separator).
    let segEnd = body.length;
    for (let j = i + 1; j < questions.length; j++) {
      const nextMarker = `"${questions[j]!.question}"="`;
      const sepIdx = body.indexOf(`, ${nextMarker}`, ansStart);
      if (sepIdx !== -1) {
        segEnd = sepIdx;
        break;
      }
      const bare = body.indexOf(nextMarker, ansStart);
      if (bare !== -1) {
        segEnd = bare;
        break;
      }
    }

    const segment = body.slice(ansStart, segEnd);
    const { answer, preview, notes } = extractPreviewNotes(segment);
    const entry: AskUserQuestionAnswer = { question: q.question, answer: splitAnswer(answer, q.multiSelect) };
    if (preview) entry.preview = preview;
    if (notes) entry.notes = notes;
    out.push(entry);
    cursor = segEnd;
  }
  return out.length > 0 ? out : undefined;
}

/** Legacy regex parse — fallback when question metadata is unavailable. */
function parseLegacy(body: string): AskUserQuestionAnswer[] {
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

export function parseAskUserQuestionResult(content: string, questions?: KnownQuestion[]): AskUserQuestionAnswer[] {
  const body = stripBody(content);
  if (body === undefined) return [];
  if (questions && questions.length > 0) {
    const anchored = parseAnchored(body, questions);
    if (anchored) return anchored;
  }
  return parseLegacy(body);
}
