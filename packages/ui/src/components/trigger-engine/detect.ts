import type { DetectedTrigger } from './types';

const WHITESPACE_RE = /\s/u;

/**
 * Finds an active trigger token ending at the cursor: scans backwards from the
 * cursor for a word-initial `triggerChar` (at index 0 or preceded by
 * whitespace), stopping at the first whitespace. Everything between the char
 * and the cursor is the query — slashes included, so `@dir/leaf` stays one
 * token.
 */
export function detectTrigger(text: string, triggerChar: string, cursorPosition: number): DetectedTrigger | null {
  const textUpToCursor = text.slice(0, cursorPosition);
  const quoted = detectQuotedTrigger(textUpToCursor, triggerChar);
  if (quoted) return quoted;
  for (let i = textUpToCursor.length - 1; i >= 0; i--) {
    const char = textUpToCursor[i]!;
    if (WHITESPACE_RE.test(char)) return null;
    if (!textUpToCursor.startsWith(triggerChar, i)) continue;
    // Mid-word occurrence: not a trigger, but an earlier one may still be.
    if (i > 0 && !WHITESPACE_RE.test(textUpToCursor[i - 1]!)) continue;
    return { query: textUpToCursor.slice(i + triggerChar.length), offset: i };
  }
  return null;
}

/**
 * A word-initial `triggerChar"` with no closing quote before the cursor
 * (`@"my dir/fi`): the token spans whitespace, and the query keeps the
 * leading quote so an insert replaces it too.
 */
function detectQuotedTrigger(textUpToCursor: string, triggerChar: string): DetectedTrigger | null {
  const offset = textUpToCursor.lastIndexOf(`${triggerChar}"`);
  if (offset === -1) return null;
  if (offset > 0 && !WHITESPACE_RE.test(textUpToCursor[offset - 1]!)) return null;
  const query = textUpToCursor.slice(offset + triggerChar.length);
  if (/["\n]/u.test(query.slice(1))) return null;
  return { query, offset };
}
