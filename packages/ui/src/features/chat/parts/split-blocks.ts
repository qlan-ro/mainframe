/**
 * Streamdown keeps a document with any footnote syntax in one block, so a reply
 * that cites a footnote early is parsed whole on every frame from then on. A
 * reference only becomes a footnote once its definition is in the same tree,
 * and definitions come at the end of a reply. So this splits as usual until a
 * definition arrives: until then the references render as plain text, exactly
 * as they would in one block.
 */
import { parseMarkdownIntoBlocks } from 'streamdown';

const FOOTNOTE_DEFINITION = /^ {0,3}\[\^[^\]\s]+\]:/m;
/** Same length as `^`, so offsets in the masked text are offsets in the original. */
const MASK = '⁠';

/**
 * A fence to its closing line, or to the end of the text while it is still open.
 * The `m` flag is for the opener's `^`; "end of text" is `(?![\s\S])` because `$`
 * would also match at the end of every line and end the fence after its first line.
 */
const END = '(?![\\s\\S])';
const FENCE = new RegExp(
  `^ {0,3}(\`{3,}|~{3,})[^\\n]*(?:\\n[\\s\\S]*?(?:\\n {0,3}\\1[\`~]*[ \\t]*(?=\\n|${END})|${END})|${END})`,
  'gm',
);
const INLINE_CODE = /(`+)[^`\n][^\n]*?\1(?!`)/g;
const blank = (match: string) => match.replace(/[^\n]/g, ' ');

/** The text with fenced and inline code blanked out (same length), so code is never read as syntax. */
function withoutCode(markdown: string): string {
  return markdown.replace(FENCE, blank).replace(INLINE_CODE, blank);
}

export function hasFootnoteSyntax(markdown: string): boolean {
  return markdown.includes('[^') && withoutCode(markdown).includes('[^');
}

export function splitFootnoteBlocks(markdown: string): string[] {
  if (FOOTNOTE_DEFINITION.test(withoutCode(markdown))) return [markdown];
  const blocks = parseMarkdownIntoBlocks(markdown.split('[^').join(`[${MASK}`));
  let at = 0;
  const out = blocks.map((block) => markdown.slice(at, (at += block.length)));
  return at === markdown.length ? out : [markdown];
}
