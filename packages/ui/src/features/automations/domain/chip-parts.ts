/**
 * Chip-part helpers — the structural editing model for `ChipText`
 * (ts153 wf2-fields.jsx `wf2MergeTail`/`wf2IsToken`/`WfChipText`, ported onto
 * the flat contract `ChipPart = string | {token: TokenRef}` union). Chip
 * fields are edited structurally (insert/remove a part, merge the draft tail,
 * backspace pops the last part) — never by parsing a rendered string.
 */
import type { ChipPart, ChipText, TokenRef } from '../contract';

export function isTokenPart(part: ChipPart): part is { token: TokenRef } {
  return typeof part === 'object' && part !== null && 'token' in part;
}

/** Commit an in-progress text draft into `parts`: append to the trailing string part, or push a new one. */
export function mergeDraftTail(parts: ChipText, draft: string): ChipText {
  if (!draft) return parts;
  const out = parts.slice();
  const last = out[out.length - 1];
  if (out.length > 0 && typeof last === 'string') {
    out[out.length - 1] = last + draft;
  } else {
    out.push(draft);
  }
  return out;
}

/** Read-only plain-text render of a chip-field value, for previews and validation messages — never for round-tripping back into parts. */
export function partsToPlainText(parts: ChipText, labelFor: (ref: TokenRef) => string): string {
  return parts.map((p) => (isTokenPart(p) ? `⟨${labelFor(p.token)}⟩` : p)).join('');
}
