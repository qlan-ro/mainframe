import { describe, it, expect } from 'vitest';
import { hasFootnoteSyntax, splitFootnoteBlocks } from '../split-blocks';

describe('hasFootnoteSyntax', () => {
  it('fires on a reference in prose', () => {
    expect(hasFootnoteSyntax('A claim[^1] in prose.')).toBe(true);
  });

  it('does not fire on `[^` inside a fence or inline code', () => {
    expect(hasFootnoteSyntax('```sh\ngrep "[^a-z]" file\n```')).toBe(false);
    expect(hasFootnoteSyntax('Use the class `[^a-z]` here.')).toBe(false);
    expect(hasFootnoteSyntax('```sh\ngrep "[^a-z]" file')).toBe(false); // fence still open
  });

  it('does not fire on `[^` on the second or a later line of a fence', () => {
    expect(hasFootnoteSyntax('```js\na\nb [^1]\nc\n```')).toBe(false);
    expect(hasFootnoteSyntax('~~~\na\n[^x]\n~~~')).toBe(false);
    expect(hasFootnoteSyntax('```js\na\nb [^1]')).toBe(false); // still open
  });

  it('fires on prose after a code fence that also holds `[^`', () => {
    expect(hasFootnoteSyntax('```\n[^a]\n```\n\nSee[^1].')).toBe(true);
  });
});

describe('splitFootnoteBlocks', () => {
  it('keeps one block once a definition arrives', () => {
    expect(splitFootnoteBlocks('One[^1].\n\nTwo.\n\n[^1]: The note.')).toHaveLength(1);
  });

  it('splits as usual until a definition arrives', () => {
    expect(splitFootnoteBlocks('One[^1].\n\nTwo.')).toEqual(['One[^1].\n\n', 'Two.']);
  });

  it('does not read a definition-looking line inside a fence as a definition', () => {
    const text = 'One[^1].\n\n```md\n[^1]: not a note\n```\n\nTwo.';
    expect(splitFootnoteBlocks(text).length).toBeGreaterThan(1);
    expect(splitFootnoteBlocks(text).join('')).toBe(text);
  });

  it('reads a definition straight after a multi-line fence as a definition', () => {
    const text = 'Claim[^1].\n\n```js\na\nb\n```\n[^1]: The note.';
    expect(splitFootnoteBlocks(text)).toEqual([text]);
  });
});
