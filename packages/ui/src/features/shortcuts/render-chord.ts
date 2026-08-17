/**
 * Chord rendering — turns a `Chord`/`PlatformChord` into the label the cheat
 * sheet (and the palette hints it drives) shows: ⌘/⌥/⌃/⇧ glyphs on macOS,
 * `Ctrl+`/`Alt+`/`Shift+` text elsewhere (AC 17). A multi-chord entry (D3,
 * `sessions.tab-by-index`'s nine chords) renders as a `first … last` range.
 */
import type { Chord, PlatformChord, ShortcutDescriptor } from './shortcut-types';
import { chordList } from './chord';

const SYMBOL_KEYS: Record<string, string> = {
  Backslash: '\\',
  Slash: '/',
  Comma: ',',
  Tab: 'Tab',
};

function keyLabel(code: string): string {
  if (code in SYMBOL_KEYS) return SYMBOL_KEYS[code] as string;
  if (code.startsWith('Digit')) return code.slice('Digit'.length);
  if (code.startsWith('Key')) return code.slice('Key'.length);
  return code;
}

function pickChord(chord: PlatformChord, isMac: boolean): Chord {
  return 'mac' in chord && 'other' in chord ? (isMac ? chord.mac : chord.other) : chord;
}

export function renderChord(chord: PlatformChord, isMac: boolean): string {
  const picked = pickChord(chord, isMac);
  const key = keyLabel(picked.code);
  if (isMac) {
    const mods = [picked.ctrl && '⌃', picked.mod && '⌘', picked.alt && '⌥', picked.shift && '⇧']
      .filter(Boolean)
      .join('');
    return `${mods}${key}`;
  }
  const parts = [picked.ctrl && 'Ctrl', picked.mod && 'Ctrl', picked.alt && 'Alt', picked.shift && 'Shift', key].filter(
    Boolean,
  );
  return parts.join('+');
}

export function renderEntryChord(entry: ShortcutDescriptor, isMac: boolean): string {
  const chords = chordList(entry);
  if (chords.length === 1) return renderChord(chords[0] as PlatformChord, isMac);
  const first = chords[0] as PlatformChord;
  const last = chords[chords.length - 1] as PlatformChord;
  return `${renderChord(first, isMac)} … ${renderChord(last, isMac)}`;
}
