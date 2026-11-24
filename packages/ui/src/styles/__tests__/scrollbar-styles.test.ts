// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const start = sheet.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing CSS rule: ${selector}`);
  return sheet.slice(start, sheet.indexOf('}', start));
}

describe('scrollbar styling (S3)', () => {
  it('hides native scrollbars in every engine, with no @supports fork', () => {
    expect(rule('  *')).toMatch(/scrollbar-width:\s*none/);
    expect(rule('  *::-webkit-scrollbar')).toMatch(/display:\s*none/);
    expect(sheet).not.toContain('@supports selector(*::-webkit-scrollbar)');
    expect(sheet).not.toMatch(/scrollbar-(?:color|gutter)\s*:/);
  });

  it('never paints a track', () => {
    expect(sheet).not.toContain('::-webkit-scrollbar-track');
    expect(rule('.mf-scrollbar')).not.toContain('background');
  });

  it('draws the thumb 6px wide and 2px from the edge, 8px under the pointer', () => {
    const thumb = rule('.mf-scrollbar > span');
    expect(thumb).toMatch(/width:\s*6px/);
    expect(thumb).toMatch(/inset:\s*0 var\(--thumb-inset\) 0 auto/);
    expect(rule('.mf-scrollbar')).toMatch(/--thumb-inset:\s*2px/);
    expect(thumb).toMatch(/border-radius:\s*3px/);
    expect(thumb).toMatch(/var\(--foreground\) 26%/);
    const held = rule('.mf-scrollbar:is(:hover, [data-dragging]) > span');
    expect(held).toMatch(/width:\s*8px/);
    expect(held).toMatch(/var\(--foreground\) 42%/);
  });

  it('drops the fade under prefers-reduced-motion', () => {
    const reduced = sheet.slice(sheet.indexOf('prefers-reduced-motion'));
    expect(reduced).toMatch(/\.mf-scrollbar,\s*\.mf-scrollbar > span {\s*transition: none/);
  });
});
