/**
 * Target eligibility — the two rules the dispatcher applies before firing a
 * matched chord: an `editorYielding` entry stands down inside the code
 * editor's own keymap (AC 5), and a chord that carries no modifier is
 * suppressed while a text field has focus so typed letters don't fire
 * shortcuts (D7's text-field rule, keyed on the RESOLVED chord, not the
 * descriptor's `mod` flag — see fact 20).
 */
import type { ResolvedChord, ShortcutDescriptor } from './shortcut-types';

const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA']);

function isTextField(target: Element): boolean {
  if (TEXT_INPUT_TAGS.has(target.tagName)) return true;
  return target.hasAttribute('contenteditable');
}

export function isEligibleTarget(
  target: EventTarget | null,
  entry: ShortcutDescriptor,
  resolved: ResolvedChord,
): boolean {
  if (!(target instanceof Element)) return true;
  if (entry.editorYielding && target.closest('.cm-editor') != null) return false;
  const carriesModifier = resolved.meta || resolved.ctrl || resolved.alt;
  if (isTextField(target) && !carriesModifier) return false;
  return true;
}
