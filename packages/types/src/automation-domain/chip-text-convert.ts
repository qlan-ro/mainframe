/**
 * The bridge between the wire's `ChipText` and the plain text the editor now
 * edits. Fields stay `ChipText` on the wire (a `["plain string"]` array is
 * already valid), so nothing about the contract changes: the editor reads text
 * in, writes a single string part back, and legacy `{token}` parts are upgraded
 * to `$name` on load.
 */
import type { ChipText, TokenRef } from '../automation.js';
import { isTokenPart } from './chip-parts.js';
import { sanitizeVariableName } from './variables.js';

/**
 * A saved field as editable text. Pass the `nameFor` of a namespace built at
 * this step (`buildVariableNamespace(scopeAt(definition, catalog, stepId))`) —
 * names are position-dependent, so a namespace from anywhere else can rebind a
 * ref to a different step.
 *
 * A ref whose step is gone has no name to take; it degrades to the sanitized
 * output name rather than inventing syntax, and `validate` then reports it as a
 * `$name` nothing defines.
 */
export function chipTextToText(parts: ChipText, nameFor: (ref: TokenRef) => string | null): string {
  return parts
    .map((part) => {
      if (!isTokenPart(part)) return part;
      const name = nameFor(part.token) ?? sanitizeVariableName(part.token.output);
      return part.token.field ? `$${name}.${part.token.field}` : `$${name}`;
    })
    .join('');
}

/** Edited text back onto the wire. Empty text is no parts, the spelling the contract already uses for an unfilled field. */
export function textToChipText(text: string): ChipText {
  return text === '' ? [] : [text];
}
