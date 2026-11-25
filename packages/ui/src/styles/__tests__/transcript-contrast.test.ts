// @vitest-environment node
/**
 * The transcript's own inks on the surfaces it puts them on (T1: text at least
 * 4.5:1 in both themes). Every surface is composited over each ground a message
 * can sit on: the thread, a marker's card, the user's bubble, a hovered row.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { composite, contrast, parseRules, resolveOklch, toRgba, type Decls, type RGBA } from './css-color';

const TEXT_MIN = 4.49;
const SHEETS = ['styles/globals.css', 'styles/domain-tokens.css', 'styles/app.css', 'features/chat/transcript.css'].map(
  (name) => parseRules(readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')),
);
const LAYERS = { light: [':root', ':root:not(.dark)'], dark: [':root', '.dark'] } as const;
type Theme = keyof typeof LAYERS;

function tokens(theme: Theme): Decls {
  const out: Decls = {};
  for (const layer of LAYERS[theme]) for (const rules of SHEETS) Object.assign(out, rules.get(layer) ?? {});
  return out;
}

function palette(theme: Theme) {
  const t = tokens(theme);
  const color = (token: string): RGBA => {
    if (t[token] === undefined) throw new Error(`missing token ${token}`);
    return toRgba(resolveOklch(t[token], (name) => t[name]!));
  };
  const over = (top: RGBA, ground: RGBA) => composite(top, ground);
  const tint = (token: string, share: number) => ({ ...color(token), a: share });
  return { color, over, tint };
}

/** The share of ink in a changed line's background, as the sheet states it. */
function tintShare(selector: string): number {
  const share = new RegExp(`div\\.${selector} \\{[^}]*?(\\d+)%, transparent`).exec(CSS)?.[1];
  if (!share) throw new Error(`no tint on ${selector}`);
  return Number(share) / 100;
}

const CSS = readFileSync(new URL('../../features/chat/transcript.css', import.meta.url), 'utf8');

it('re-points the app’s inks on every surface that tints its ground', () => {
  expect(CSS).toMatch(
    /\.bg-mf-tr-code,\s*\.bg-mf-tr-term \{\s*--muted-foreground: var\(--mf-tr-muted\);\s*--fail: var\(--mf-tr-code-fail\);/,
  );
  expect(CSS).toMatch(/\.bg-mf-tr-code \.mf-link,[^{]*\{\s*color: var\(--mf-tr-code-link\)/);
  expect(CSS).toMatch(/\.mf-tr-bubble \{\s*--muted-foreground: var\(--mf-tr-muted\);\s*--primary: var\(--mf-tr-link\)/);
});

it('marks the row a jump lands on, and still does without motion', () => {
  expect(CSS).toMatch(/\[data-activity-flash\] \{[^}]*animation: mf-activity-flash 2200ms/);
  expect(CSS).toMatch(/prefers-reduced-motion: reduce\) \{[^@]*\[data-activity-flash\] \{[^}]*box-shadow/);
});

describe.each(['light', 'dark'] as const)('the transcript’s text in %s', (theme) => {
  const { color, over, tint } = palette(theme);
  const background = color('--background');
  const grounds = { thread: background, card: color('--card') };
  const bubble = over(color('--muted'), background);
  // A row's hover fill (`hover:bg-muted/60`).
  const hovered = over(tint('--muted', 0.6), background);
  const codeOn = (ground: RGBA) => over(color('--mf-tr-code'), ground);

  const check = (ink: string, surface: string, ground: RGBA) =>
    expect(contrast(over(color(ink), ground), ground), `${ink} on ${surface}`).toBeGreaterThanOrEqual(TEXT_MIN);
  const all = (inks: readonly string[], surface: string, ground: RGBA) => {
    for (const ink of inks) check(ink, surface, ground);
  };
  const INKS = [
    '--foreground',
    '--muted-foreground',
    '--mf-tr-link',
    '--mf-tr-ok',
    '--mf-tr-del',
    '--fail',
    '--warning',
  ];

  it('reads on the thread and on a card', () => {
    for (const [name, ground] of Object.entries(grounds)) all(INKS, name, ground);
  });
  it('reads on a hovered row', () => all(INKS, 'a hovered row', hovered));
  it('reads in the user’s bubble', () => all(['--foreground', '--mf-tr-muted', '--mf-tr-link'], 'the bubble', bubble));

  it('reads on a code surface', () => {
    for (const [name, ground] of Object.entries(grounds))
      all(
        ['--foreground', '--mf-tr-muted', '--mf-tr-code-link', '--mf-tr-code-fail'],
        `code on ${name}`,
        codeOn(ground),
      );
    check('--foreground', 'inline code in the bubble', codeOn(bubble));
  });

  it('reads on a changed line', () => {
    for (const [line, ink] of [
      ['mf-tr-add', '--mf-tr-ok'],
      ['mf-tr-del', '--mf-tr-del'],
    ] as const) {
      const ground = over(tint(ink, tintShare(line)), codeOn(background));
      all([ink, '--foreground', '--mf-tr-muted'], line, ground);
    }
  });

  it('reads in the terminal', () => {
    for (const [name, ground] of Object.entries(grounds))
      all(
        ['--mf-tr-term-ink', '--mf-tr-term-ok', '--mf-tr-term-err', '--mf-tr-muted'],
        `the terminal on ${name}`,
        over(color('--mf-tr-term'), ground),
      );
  });
});
