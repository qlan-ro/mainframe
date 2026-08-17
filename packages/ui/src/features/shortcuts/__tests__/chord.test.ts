/**
 * Chord resolution and matching — the platform-independent core the dispatcher
 * and the cheat sheet both build on. `resolveChord` turns a platform-agnostic
 * `mod` into the real modifier for the current OS; `matchesChord` matches the
 * PHYSICAL key (`KeyboardEvent.code`) and is exact on all four modifier flags,
 * so a chord that omits `shift` never fires while Shift is held.
 */
import { describe, expect, it } from 'vitest';
import type { Chord, ShortcutDescriptor } from '../shortcut-types';
import { chordList, matchesChord, resolveChord } from '../chord';

/** A minimal keydown shape — matching reads only the code + modifier fields;
 *  `key` is included only to prove matching ignores it. */
interface FakeKeydown {
  code: string;
  key?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

function keydown(over: Partial<FakeKeydown> & { code: string }): FakeKeydown {
  return { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over };
}

function entry(chord: ShortcutDescriptor['chord']): ShortcutDescriptor {
  return { id: 'fixture.entry', chord, label: 'Fixture', group: 'App' };
}

describe('resolveChord', () => {
  it('resolves mod to meta on macOS', () => {
    expect(resolveChord({ code: 'KeyN', mod: true }, true)).toEqual({
      code: 'KeyN',
      meta: true,
      ctrl: false,
      alt: false,
      shift: false,
    });
  });

  it('resolves mod to ctrl off macOS', () => {
    expect(resolveChord({ code: 'KeyN', mod: true }, false)).toEqual({
      code: 'KeyN',
      meta: false,
      ctrl: true,
      alt: false,
      shift: false,
    });
  });

  it('resolves literal ctrl to ctrl on macOS', () => {
    expect(resolveChord({ code: 'Tab', ctrl: true }, true)).toEqual({
      code: 'Tab',
      meta: false,
      ctrl: true,
      alt: false,
      shift: false,
    });
  });

  it('resolves literal ctrl to ctrl off macOS', () => {
    expect(resolveChord({ code: 'Tab', ctrl: true }, false)).toEqual({
      code: 'Tab',
      meta: false,
      ctrl: true,
      alt: false,
      shift: false,
    });
  });

  it('picks the mac branch of a platform-variant chord', () => {
    const chord: Chord | { mac: Chord; other: Chord } = {
      mac: { code: 'Digit1', ctrl: true },
      other: { code: 'Digit1', alt: true },
    };
    expect(resolveChord(chord, true)).toEqual({
      code: 'Digit1',
      meta: false,
      ctrl: true,
      alt: false,
      shift: false,
    });
  });

  it('picks the other branch of a platform-variant chord', () => {
    const chord: Chord | { mac: Chord; other: Chord } = {
      mac: { code: 'Digit1', ctrl: true },
      other: { code: 'Digit1', alt: true },
    };
    expect(resolveChord(chord, false)).toEqual({
      code: 'Digit1',
      meta: false,
      ctrl: false,
      alt: true,
      shift: false,
    });
  });
});

describe('matchesChord — exact on all four flags', () => {
  it('does not match when the event holds Shift and the chord does not declare it (AC 7)', () => {
    const resolved = resolveChord({ code: 'KeyR', mod: true }, true);
    const event = keydown({ code: 'KeyR', metaKey: true, shiftKey: true });
    expect(matchesChord(event, resolved)).toBe(false);
  });

  it('matches when the event holds exactly the declared shift', () => {
    const resolved = resolveChord({ code: 'KeyR', mod: true, shift: true }, true);
    const event = keydown({ code: 'KeyR', metaKey: true, shiftKey: true });
    expect(matchesChord(event, resolved)).toBe(true);
  });

  it('does not match a ⌘-held event when the chord declares no mod', () => {
    const resolved = resolveChord({ code: 'KeyN' }, true);
    const event = keydown({ code: 'KeyN', metaKey: true });
    expect(matchesChord(event, resolved)).toBe(false);
  });

  it('matches ⌘⇧\\ by code alone, ignoring the shifted event.key (AC 8)', () => {
    const resolved = resolveChord({ code: 'Backslash', mod: true, shift: true }, true);
    const event = keydown({ code: 'Backslash', key: '|', metaKey: true, shiftKey: true });
    expect(matchesChord(event, resolved)).toBe(true);
  });

  it('matches ⌘⇧T by code alone, ignoring event.key (AC 8)', () => {
    const resolved = resolveChord({ code: 'KeyT', mod: true, shift: true }, true);
    const event = keydown({ code: 'KeyT', key: 'T', metaKey: true, shiftKey: true });
    expect(matchesChord(event, resolved)).toBe(true);
  });

  it('does not match a different physical key even with identical modifiers', () => {
    const resolved = resolveChord({ code: 'KeyN', mod: true }, true);
    const event = keydown({ code: 'KeyM', metaKey: true });
    expect(matchesChord(event, resolved)).toBe(false);
  });
});

describe('chordList', () => {
  it('wraps a single Chord in a one-element array', () => {
    const chord: Chord = { code: 'KeyN', mod: true };
    expect(chordList(entry(chord))).toEqual([chord]);
  });

  it('wraps a single platform-variant chord in a one-element array', () => {
    const chord = { mac: { code: 'Digit1', ctrl: true }, other: { code: 'Digit1', alt: true } };
    expect(chordList(entry(chord))).toEqual([chord]);
  });

  it('passes an array of chords through unchanged', () => {
    const chords: Chord[] = [
      { code: 'Digit1', ctrl: true },
      { code: 'Digit2', ctrl: true },
    ];
    expect(chordList(entry(chords))).toEqual(chords);
  });
});
