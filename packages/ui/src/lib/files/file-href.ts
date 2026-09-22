/**
 * lib/files/file-href.ts — the single predicate for "is this href a file
 * reference".
 *
 * Both the markdown `urlTransform` (so the sanitiser stops stripping a file
 * link) and `SmartLink` (so the anchor renders as a file reference instead of
 * a web link) call this same function — if the two disagreed, one would treat
 * an href as a live link that the other treats as plain text.
 *
 * `toFileRef` (file-ref.ts) stays the normaliser that turns an accepted path
 * into the absolute/relative strings the menu copies; it is not a predicate
 * (a bare hostname has no `file://` prefix and no leading `/`, so it falls
 * into `toFileRef`'s already-relative branch and comes back as a FileRef too).
 */

export interface FileHrefTarget {
  /**
   * The href with any trailing `:line[:col]` suffix removed. Percent-decoded,
   * except for a `file://` target — `toFileRef` decodes those itself, so
   * decoding here too would double-decode.
   */
  path: string;
  /** 0-based line number, present only when the href carried a numeric suffix. */
  line?: number;
  /** 0-based character offset. Always present when `line` is. */
  character?: number;
}

const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const SUFFIX_RE = /:(\d+)(?::(\d+))?$/;

function splitSuffix(href: string): { path: string; line?: number; character?: number } {
  const match = SUFFIX_RE.exec(href);
  if (!match) return { path: href };
  const line = Math.max(0, Number(match[1]) - 1);
  const character = match[2] === undefined ? 0 : Math.max(0, Number(match[2]) - 1);
  return { path: href.slice(0, match.index), line, character };
}

/** A single-segment relative target with a dot and no leading `.` is a hostname (`example.com/page`), not a path. */
function looksLikeHostname(href: string): boolean {
  const firstSlash = href.indexOf('/');
  if (firstSlash === -1) return false;
  const firstSegment = href.slice(0, firstSlash);
  return firstSegment.includes('.') && !firstSegment.startsWith('.');
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Classifies `href` as a file reference, or returns `null` for anything else (web links, anchors, queries). */
export function parseFileHref(href: string): FileHrefTarget | null {
  if (!href || href.startsWith('#') || href.startsWith('?')) return null;

  const scheme = SCHEME_RE.exec(href)?.[1];
  const isFileUri = scheme !== undefined && scheme.toLowerCase() === 'file';
  if (scheme !== undefined && !isFileUri) return null;

  if (!isFileUri && !href.startsWith('/') && looksLikeHostname(href)) return null;

  const { path, line, character } = splitSuffix(href);
  return { path: isFileUri ? path : safeDecode(path), line, character };
}
