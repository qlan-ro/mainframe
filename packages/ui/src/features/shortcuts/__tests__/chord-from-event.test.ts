import { describe, expect, it } from 'vitest';
import { chordFromEvent } from '../chord-from-event';

const press = (over: Partial<Parameters<typeof chordFromEvent>[0]>) => ({
  code: 'KeyK',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe('chordFromEvent', () => {
  it('records ⌘ as mod on macOS', () => {
    expect(chordFromEvent(press({ metaKey: true }), true)).toEqual({ code: 'KeyK', mod: true });
  });

  it('records Ctrl as mod off macOS, never as a literal ctrl', () => {
    const chord = chordFromEvent(press({ ctrlKey: true }), false);

    expect(chord).toEqual({ code: 'KeyK', mod: true });
    expect(chord?.ctrl).toBeUndefined();
  });

  it('keeps ⌃ as a literal control on macOS, where it is distinct from ⌘', () => {
    expect(chordFromEvent(press({ ctrlKey: true }), true)).toEqual({ code: 'KeyK', ctrl: true });
  });

  it('carries alt and shift', () => {
    expect(chordFromEvent(press({ metaKey: true, altKey: true, shiftKey: true }), true)).toEqual({
      code: 'KeyK',
      mod: true,
      alt: true,
      shift: true,
    });
  });

  it('rejects a modifier held alone — the user is still reaching', () => {
    expect(chordFromEvent(press({ code: 'MetaLeft', metaKey: true }), true)).toBeNull();
    expect(chordFromEvent(press({ code: 'ShiftRight', shiftKey: true }), true)).toBeNull();
  });

  it('rejects a bare key, which would fire while typing', () => {
    expect(chordFromEvent(press({}), true)).toBeNull();
    expect(chordFromEvent(press({ shiftKey: true }), true)).toBeNull();
  });

  it('accepts alt alone as a modifier', () => {
    expect(chordFromEvent(press({ altKey: true }), true)).toEqual({ code: 'KeyK', alt: true });
  });

  it('records the physical code, so a shifted chord survives a layout change', () => {
    expect(chordFromEvent(press({ code: 'Backslash', metaKey: true, shiftKey: true }), true)).toEqual({
      code: 'Backslash',
      mod: true,
      shift: true,
    });
  });
});
