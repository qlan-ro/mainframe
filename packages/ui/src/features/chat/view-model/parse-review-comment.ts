/**
 * Parse a diff-review comment message (desktop `format-line-comment.ts` +
 * DiffTab/DiffView producers) back into its structure for the ReviewCommentCard:
 *
 *   Diff of `<filePath>`
 *
 *   At line 43:            ← or "At lines 51-53:"
 *   ```\n<line content>\n```   ← optional; fence is 3+ backticks (grown past
 *   <comment text>               backtick runs in the content)
 *
 *   ---                    ← multiple comments joined by \n\n---\n\n
 *
 * STRICT: any part that doesn't match the producer shape makes the whole
 * parse return null — the message then falls back to the plain markdown
 * bubble, so nothing is ever swallowed.
 */
export interface ReviewCommentItem {
  start: number;
  end?: number;
  /** The quoted line content; '' when the producer sent no fence. */
  code: string;
  /** The user's comment text (markdown). */
  body: string;
}

export interface ReviewComment {
  file: string;
  comments: ReviewCommentItem[];
}

const HEADER_RE = /^Diff of `([^`\n]+)`\n\n([\s\S]*)$/;
const PART_RE = /^At line(s)? (\d+)(?:-(\d+))?:\n([\s\S]*)$/;

function parsePart(part: string): ReviewCommentItem | null {
  const m = part.match(PART_RE);
  if (!m) return null;
  const start = Number(m[2]);
  const end = m[3] != null ? Number(m[3]) : undefined;
  let rest = m[4] ?? '';

  let code = '';
  const fenceMatch = rest.match(/^(`{3,})\n([\s\S]*?)\n\1\n?([\s\S]*)$/);
  if (fenceMatch) {
    code = fenceMatch[2]!;
    rest = fenceMatch[3] ?? '';
  }
  const body = rest.trim();
  if (!body) return null;

  const item: ReviewCommentItem = { start, code, body };
  if (end != null) item.end = end;
  return item;
}

export function parseReviewComment(text: string): ReviewComment | null {
  const header = text.match(HEADER_RE);
  if (!header) return null;
  const file = header[1]!;
  const parts = header[2]!.split('\n\n---\n\n');
  const comments: ReviewCommentItem[] = [];
  for (const part of parts) {
    const item = parsePart(part.trim());
    if (!item) return null;
    comments.push(item);
  }
  if (comments.length === 0) return null;
  return { file, comments };
}
