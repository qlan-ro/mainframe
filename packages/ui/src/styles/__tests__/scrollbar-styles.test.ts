// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

function blockAfter(source: string, header: string): string {
  const headerStart = source.indexOf(header);
  if (headerStart < 0) throw new Error(`missing CSS block: ${header}`);

  const openingBrace = source.indexOf('{', headerStart + header.length);
  if (openingBrace < 0) throw new Error(`missing opening brace after: ${header}`);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`missing closing brace after: ${header}`);
}

describe('scrollbar styling paths', () => {
  const base = blockAfter(sheet, '@layer base');
  const webkitQuery = 'selector(*::-webkit-scrollbar)';

  it('directly paints a transparent track in WebKit without conflicting standard properties', () => {
    const webkit = blockAfter(base, `@supports ${webkitQuery}`);

    expect(webkit).toMatch(
      /\*::-webkit-scrollbar-track,\s*\*::-webkit-scrollbar-corner\s*{\s*background:\s*transparent/,
    );
    expect(webkit).toMatch(/\*::-webkit-scrollbar-thumb\s*{\s*background:\s*transparent/);
    expect(webkit).toMatch(/\*:hover::-webkit-scrollbar-thumb\s*{\s*background:\s*var\(--border\)/);
    expect(webkit).not.toMatch(/scrollbar-(?:color|width)\s*:/);
  });

  it('retains the standards path when WebKit scrollbar parts are unavailable', () => {
    const standards = blockAfter(base, `@supports not ${webkitQuery}`);

    expect(standards).toContain('scrollbar-width: thin');
    expect(standards).toContain('scrollbar-color: transparent transparent');
    expect(standards).not.toContain('::-webkit-scrollbar');
  });
});
