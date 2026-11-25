/** Nothing in a rule or command is invisible, or moves the text around it. */
import { describe, expect, it } from 'vitest';
import { visibleLine, visibleText } from '../visible-text';

describe('visibleText', () => {
  it.each([
    ['a right-to-left override', 'rm ‮hs.x', 'rm ⟨U+202E⟩hs.x'],
    ['a bidirectional isolate', 'a⁦b⁩', 'a⟨U+2066⟩b⟨U+2069⟩'],
    ['a zero-width space', 'cargo​test', 'cargo⟨U+200B⟩test'],
    ['a carriage return', 'safe\rrm', 'safe⟨U+000D⟩rm'],
    ['an escape and a delete', '\u001B[2K\u007F', '⟨U+001B⟩[2K⟨U+007F⟩'],
    ['a no-break space', 'a b', 'a⟨U+00A0⟩b'],
    ['a line separator', 'a b', 'a⟨U+2028⟩b'],
    ['a letter drawn as nothing', 'aㅤb', 'a⟨U+3164⟩b'],
    ['a tag outside the first plane', 'a\u{E0041}b', 'a⟨U+E0041⟩b'],
  ])('spells out %s', (_what, text, shown) => {
    expect(visibleText(text)).toBe(shown);
  });

  it('leaves ordinary text, spaces, tabs and lines alone', () => {
    const text = 'cargo test  --all\n\t&& écho "日本語"';
    expect(visibleText(text)).toBe(text);
  });
});

it('visibleLine also spells out a line break, which would pass for another rule', () => {
  expect(visibleLine('ls\nAllow Bash(rm *)')).toBe('ls⟨U+000A⟩Allow Bash(rm *)');
});
