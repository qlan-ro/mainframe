// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(new URL('../globals.css', import.meta.url), 'utf8');

describe('root overscroll', () => {
  it('disables rubber-banding on the root scroller', () => {
    const html = sheet.match(/\n\s*html\s*{([^}]*)}/);

    expect(html?.[1]).toMatch(/overscroll-behavior:\s*none/);
  });
});
