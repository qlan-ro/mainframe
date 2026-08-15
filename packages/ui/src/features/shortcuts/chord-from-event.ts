/**
 * Turning a keypress into a bindable chord — the recorder's whole contract.
 *
 * Matching reads `KeyboardEvent.code` (the physical key), so recording must
 * store the same thing: capture the character instead and a shifted chord
 * stops working the moment the layout changes.
 */
import type { Chord } from './shortcut-types';

/** Held alone these are not a chord, they are the user still reaching. */
const MODIFIER_CODES = new Set([
  'MetaLeft',
  'MetaRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'CapsLock',
]);

export interface RecordableKeydown {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * The chord this keypress would bind, or `null` if it is not bindable.
 *
 * Rejects modifier-only presses and anything without a modifier: a bare letter
 * would fire while typing, and the dispatcher's text-field rule only exempts
 * chords that carry one.
 */
export function chordFromEvent(event: RecordableKeydown, isMac: boolean): Chord | null {
  if (MODIFIER_CODES.has(event.code)) return null;

  // `mod` is ⌘ on macOS and Ctrl elsewhere, so a literal `ctrl` is only
  // meaningful on macOS — off it, Ctrl IS mod and setting both would resolve
  // to the same flag twice.
  const mod = isMac ? event.metaKey : event.ctrlKey;
  const ctrl = isMac ? event.ctrlKey : false;
  if (!mod && !ctrl && !event.altKey) return null;

  const chord: Chord = { code: event.code };
  if (mod) chord.mod = true;
  if (ctrl) chord.ctrl = true;
  if (event.altKey) chord.alt = true;
  if (event.shiftKey) chord.shift = true;
  return chord;
}
