/**
 * Chord resolution and matching. `resolveChord` turns a platform-agnostic
 * `mod` into the real modifier for the current OS; `matchesChord` matches the
 * PHYSICAL key (`KeyboardEvent.code`) and is exact on all four modifier
 * flags, so a chord that omits `shift` never fires while Shift is held.
 */
import type { Chord, PlatformChord, ResolvedChord, ShortcutDescriptor } from './shortcut-types';

function isPlatformVariant(chord: PlatformChord): chord is { mac: Chord; other: Chord } {
  return 'mac' in chord && 'other' in chord;
}

export function resolveChord(chord: PlatformChord, isMac: boolean): ResolvedChord {
  const picked = isPlatformVariant(chord) ? (isMac ? chord.mac : chord.other) : chord;
  return {
    code: picked.code,
    meta: isMac ? (picked.mod ?? false) : false,
    ctrl: (isMac ? false : (picked.mod ?? false)) || (picked.ctrl ?? false),
    alt: picked.alt ?? false,
    shift: picked.shift ?? false,
  };
}

/** Minimal shape of a keydown event: the fields matching reads, nothing more. */
export interface MatchableKeydown {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function matchesChord(event: MatchableKeydown, resolved: ResolvedChord): boolean {
  return (
    event.code === resolved.code &&
    event.metaKey === resolved.meta &&
    event.ctrlKey === resolved.ctrl &&
    event.altKey === resolved.alt &&
    event.shiftKey === resolved.shift
  );
}

/** Normalizes an entry's `chord` field to an array, whatever shape it was
 *  declared in (single chord, single platform-variant chord, or an array). */
export function chordList(entry: ShortcutDescriptor): readonly PlatformChord[] {
  return Array.isArray(entry.chord) ? entry.chord : [entry.chord as PlatformChord];
}

/** A resolved chord's identity for conflict detection and dispatch lookup —
 *  two chords collide iff they share this key. */
export function chordKey(resolved: ResolvedChord): string {
  return `${resolved.code}|${resolved.meta}|${resolved.ctrl}|${resolved.alt}|${resolved.shift}`;
}
