export interface AtToken {
  mode: 'fuzzy' | 'autocomplete';
  /** Fuzzy-mode search query (empty in autocomplete mode). */
  query: string;
  /** Autocomplete-mode directory (project-relative). Empty in fuzzy mode. */
  dir: string;
  /** Autocomplete-mode prefix to filter. Empty in fuzzy mode. */
  leaf: string;
  /** Offset of '@' in the composer text. */
  startOffset: number;
  /** Offset past the last char of the token (end of whitespace-free run after '@'). */
  endOffset: number;
}

/**
 * Parse the @-token at or ending at the caret.
 * Returns null if no @-token ends at the caret position (e.g. caret is
 * past whitespace after the token, or there is no @ at all).
 */
export function parseAtToken(text: string, caret: number): AtToken | null {
  let at = -1;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === undefined) break;
    if (/\s/.test(ch)) return null;
    if (ch === '@') {
      const prev = i === 0 ? ' ' : text[i - 1];
      if (prev === undefined || /\s/.test(prev)) {
        at = i;
      }
      break;
    }
  }
  if (at === -1) return null;

  let end = at + 1;
  while (end < text.length) {
    const ch = text[end];
    if (ch === undefined || /\s/.test(ch)) break;
    end++;
  }
  if (caret > end) return null;

  const tokenBody = text.slice(at + 1, end);
  const lastSlash = tokenBody.lastIndexOf('/');

  if (lastSlash === -1) {
    return {
      mode: 'fuzzy',
      query: tokenBody,
      dir: '',
      leaf: '',
      startOffset: at,
      endOffset: end,
    };
  }

  const rawDir = tokenBody.slice(0, lastSlash);
  const dir = rawDir === '' ? '.' : rawDir;
  const leaf = tokenBody.slice(lastSlash + 1);
  return {
    mode: 'autocomplete',
    query: '',
    dir,
    leaf,
    startOffset: at,
    endOffset: end,
  };
}
