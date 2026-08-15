/**
 * Chord rendering — turns a `Chord`/`PlatformChord` into the label the cheat
 * sheet (and the palette hints it drives) shows: ⌘/⌥/⌃/⇧ glyphs on macOS,
 * `Ctrl+`/`Alt+`/`Shift+` text elsewhere (AC 17). A multi-chord entry (D3,
 * `sessions.tab-by-index`'s nine chords) renders as a `first … last` range.
 */
import { describe, expect, it } from 'vitest';
import type { ShortcutDescriptor } from '../shortcut-types';
import { renderChord, renderEntryChord } from '../render-chord';

function entry(chord: ShortcutDescriptor['chord']): ShortcutDescriptor {
  return { id: 'fixture.entry', chord, label: 'Fixture', group: 'App' };
}

describe('renderChord — macOS', () => {
  it('renders mod+shift+letter as glyphs with no separator', () => {
    expect(renderChord({ code: 'KeyR', mod: true, shift: true }, true)).toBe('⌘⇧R');
  });

  it('renders a lone alt modifier as ⌥', () => {
    expect(renderChord({ code: 'KeyR', alt: true }, true)).toBe('⌥R');
  });

  it('renders a lone ctrl modifier as ⌃', () => {
    expect(renderChord({ code: 'Tab', ctrl: true }, true)).toBe('⌃Tab');
  });

  it('renders the Backslash key as \\', () => {
    expect(renderChord({ code: 'Backslash', mod: true }, true)).toBe('⌘\\');
  });

  it('renders the Slash key as /', () => {
    expect(renderChord({ code: 'Slash', mod: true }, true)).toBe('⌘/');
  });

  it('renders the Comma key as ,', () => {
    expect(renderChord({ code: 'Comma', mod: true }, true)).toBe('⌘,');
  });

  it('renders a digit key as the bare digit', () => {
    expect(renderChord({ code: 'Digit1', mod: true }, true)).toBe('⌘1');
  });
});

describe('renderChord — non-macOS', () => {
  it('renders mod+shift+letter as text joined by +', () => {
    expect(renderChord({ code: 'KeyR', mod: true, shift: true }, false)).toBe('Ctrl+Shift+R');
  });

  it('renders a lone alt modifier as Alt', () => {
    expect(renderChord({ code: 'KeyR', alt: true }, false)).toBe('Alt+R');
  });

  it('renders a lone ctrl modifier as Ctrl', () => {
    expect(renderChord({ code: 'Tab', ctrl: true }, false)).toBe('Ctrl+Tab');
  });

  it('renders the Backslash key as \\', () => {
    expect(renderChord({ code: 'Backslash', mod: true }, false)).toBe('Ctrl+\\');
  });
});

describe('renderChord — platform-variant chords', () => {
  const chord = { mac: { code: 'Digit1', ctrl: true }, other: { code: 'Digit1', alt: true } };

  it('picks the mac variant on macOS', () => {
    expect(renderChord(chord, true)).toBe('⌃1');
  });

  it('picks the other variant off macOS', () => {
    expect(renderChord(chord, false)).toBe('Alt+1');
  });
});

describe('renderEntryChord', () => {
  it('renders a single-chord entry the same as renderChord', () => {
    const single = entry({ code: 'KeyN', mod: true });
    expect(renderEntryChord(single, true)).toBe('⌘N');
    expect(renderEntryChord(single, false)).toBe('Ctrl+N');
  });

  it('renders a nine-chord entry as a first … last range on macOS (D3)', () => {
    const chords = Array.from({ length: 9 }, (_, i) => ({
      mac: { code: `Digit${i + 1}`, ctrl: true },
      other: { code: `Digit${i + 1}`, alt: true },
    }));
    const multi = entry(chords);
    expect(renderEntryChord(multi, true)).toBe('⌃1 … ⌃9');
  });

  it('renders a nine-chord entry as a first … last range off macOS (D3)', () => {
    const chords = Array.from({ length: 9 }, (_, i) => ({
      mac: { code: `Digit${i + 1}`, ctrl: true },
      other: { code: `Digit${i + 1}`, alt: true },
    }));
    const multi = entry(chords);
    expect(renderEntryChord(multi, false)).toBe('Alt+1 … Alt+9');
  });
});
