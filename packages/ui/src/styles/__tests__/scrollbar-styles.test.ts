// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

function blockAfter(header: string): string {
  const headerStart = sheet.indexOf(header);
  if (headerStart < 0) throw new Error(`missing CSS block: ${header}`);

  const openingBrace = sheet.indexOf('{', headerStart + header.length);
  if (openingBrace < 0) throw new Error(`missing opening brace after: ${header}`);

  let depth = 0;
  for (let index = openingBrace; index < sheet.length; index += 1) {
    if (sheet[index] === '{') depth += 1;
    if (sheet[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) return sheet.slice(openingBrace + 1, index);
  }

  throw new Error(`missing closing brace after: ${header}`);
}

describe('scrollbar styling paths', () => {
  it('directly paints a transparent track in WebKit without conflicting standard properties', () => {
    const webkit = blockAfter('@supports selector(*::-webkit-scrollbar)');

    expect(webkit).toMatch(
      /\*::-webkit-scrollbar-track,\s*\*::-webkit-scrollbar-corner\s*{\s*background:\s*transparent/,
    );
    expect(webkit).toMatch(/\*::-webkit-scrollbar-thumb\s*{\s*background:\s*transparent/);
    expect(webkit).toMatch(/\*:hover::-webkit-scrollbar-thumb\s*{\s*background:\s*var\(--border\)/);
    expect(webkit).not.toMatch(/scrollbar-(?:color|width)\s*:/);
  });

  it('retains the standards path only when WebKit pseudo-elements are unavailable', () => {
    const standards = blockAfter('@supports not selector(*::-webkit-scrollbar)');

    expect(standards).toContain('scrollbar-width: thin');
    expect(standards).toContain('scrollbar-color: transparent transparent');
    expect(standards).not.toContain('::-webkit-scrollbar');
  });
});
