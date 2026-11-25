/**
 * Text a request asks the user to approve, with nothing left to the renderer:
 * a character that cannot be seen, or that moves the ones around it, is spelled
 * out. A right-to-left override or a zero-width space would otherwise make a
 * rule read as another one.
 *
 * Escaped: controls (but tab and line feed), formatting characters (bidirectional
 * controls, zero-width characters, tags), every space but U+0020, line and
 * paragraph separators, and letters drawn as nothing. Pair with
 * `whitespace-pre-wrap` and `stored-order`, which keep what is left as written:
 * ordinary right-to-left letters would otherwise reorder the punctuation and
 * digits around them, with no control character to spell out.
 */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}\p{Default_Ignorable_Code_Point}⠀]/gu;
const KEPT = new Set([' ', '\n', '\t']);

const spelledOut = (char: string): string => `⟨U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟩`;

export function visibleText(text: string): string {
  return text.replace(HIDDEN, (char) => (KEPT.has(char) ? char : spelledOut(char)));
}

/**
 * One line: for a label that cannot break, and for a rule in a list, where a
 * line of its own would pass for another rule.
 */
export function visibleLine(text: string): string {
  return visibleText(text).replace(/\n/g, '⟨U+000A⟩').replace(/\t/g, '⟨U+0009⟩');
}
