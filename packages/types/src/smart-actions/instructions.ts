/**
 * Slash-instruction detection for the in-chat smart-action chips (#278).
 * Pure and React-free — the UI decides where to run it, this module only
 * answers what the text says.
 *
 * Grammar: `/` plus a name of `[a-zA-Z0-9_-]+`, optionally one `:` segment
 * (`/codex:review`), at a token boundary (start of text or preceded by
 * whitespace), not followed by `/` (paths), `:` (a second segment), or `.`
 * plus a word character (file references).
 *
 * The spec's single `parseSlashInstruction` is this pair:
 * {@link findSlashInstructions} scans prose for bare tokens,
 * {@link parseInstructionLine} reads a whole code span or fence line.
 */

const NAME = '[a-zA-Z0-9_-]+';
const TOKEN_RE = new RegExp(`(?<=^|\\s)/(${NAME}(?::${NAME})?)`, 'g');
const WHOLE_TOKEN_RE = new RegExp(`^/(${NAME}(?::${NAME})?)$`);

export interface InstructionMatch {
  /** Offset of the leading `/` in the scanned text. */
  start: number;
  /** Offset one past the last character of `token`. */
  end: number;
  /** The matched text, e.g. `/domain-modeling` — `text.slice(start, end)`. */
  token: string;
  /** `token` without its leading slash, e.g. `codex:review`. */
  name: string;
}

/**
 * Scans prose for bare instruction tokens. Arguments following a token are
 * never captured — for that, see {@link parseInstructionLine}.
 */
export function findSlashInstructions(text: string): InstructionMatch[] {
  const matches: InstructionMatch[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index;
    const token = m[0];
    const end = start + token.length;
    if (isExcludedByTrailer(text, end)) continue;
    matches.push({ start, end, token, name: m[1]! });
  }
  return matches;
}

function isExcludedByTrailer(text: string, end: number): boolean {
  const next = text[end];
  if (next === undefined) return false;
  if (next === '/' || next === ':') return true;
  return next === '.' && /\w/.test(text[end + 1] ?? '');
}

export interface InstructionLine {
  /**
   * The whole trimmed line — instruction *and* arguments — as it should be
   * inserted into a composer. Deliberately not called `token`: an
   * {@link InstructionMatch} token is the bare `/name`, and inserting the
   * wrong one of the two silently drops the arguments.
   */
  insertText: string;
  /** The instruction name, for the skills-catalog lookup. */
  name: string;
}

/**
 * Reads a whole code span or fence line that is one instruction plus optional
 * arguments (`/todo-pipeline run`). Anything else — a prefix, a second line,
 * a name outside the grammar — is not an instruction.
 */
export function parseInstructionLine(text: string): InstructionLine | null {
  const insertText = text.trim();
  if (!insertText || insertText.includes('\n')) return null;
  const head = insertText.split(/\s/, 1)[0]!;
  const name = WHOLE_TOKEN_RE.exec(head)?.[1];
  return name ? { insertText, name } : null;
}
