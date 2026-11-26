import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(resolve(__dirname, '../globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of `selector`'s rule, in or out of a list. */
function ruleBody(selector: string, property: string): string {
  const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const match = rules.find(([, selectors, body]) => selectors!.includes(selector) && body!.includes(`${property}:`));
  if (!match) throw new Error(`no ${property} on ${selector}`);
  return match[2]!;
}

/** Every `calc(…)` in `css`, nested parentheses included. */
function calcs(css: string): string[] {
  return [...css.matchAll(/calc\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g)].map(([calc]) => calc);
}

// WebKit leaks memory every time it resolves a mask calc() that mixes a percentage and a length. A scroll fade's
// mask is resolved every frame, so shadcn's recipe leaked for as long as a window was open.
describe('scroll fades', () => {
  it.each([
    ['.scroll-fade-y', '--scroll-fade-block'],
    ['.scroll-fade-x', '--scroll-fade-inline'],
    ['@utility scroll-fade-sticky', '--scroll-fade-mask'],
  ])('%s overrides %s without a percentage in a calc()', (selector, property) => {
    const mixed = calcs(ruleBody(selector, property)).filter((calc) => calc.includes('%'));
    expect(mixed).toEqual([]);
  });

  it('keeps shadcn’s 96 px reveal at both ends', () => {
    expect(CSS).not.toMatch(/animation-range/);
  });

  it('mirrors the horizontal ramps right to left', () => {
    expect(ruleBody("[dir='rtl']", '--scroll-fade-inline')).toMatch(
      /to left, transparent 0, #000 var\(--scroll-fade-s, 0px\)\),\s*linear-gradient\(to right, transparent 0, #000 var\(--scroll-fade-e/,
    );
  });

  it('overrides shadcn’s utilities from outside their layer', () => {
    const before = CSS.slice(0, CSS.indexOf('.scroll-fade-y {'));
    expect(before.split('{').length).toBe(before.split('}').length);
  });
});
