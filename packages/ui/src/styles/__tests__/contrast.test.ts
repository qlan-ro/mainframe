// @vitest-environment node
/**
 * Contrast guardrail — the CI encoding of the typography/legibility audit
 * (docs/architecture/2026-07-11-typography-legibility-audit.md §7).
 *
 * Parses the six appearance blocks in globals.css, resolves each token through
 * the real cascade (ocean/velvet LIGHT inherit `--background` from :root, dark
 * blocks layer `.dark` under the scheme selector), composites alpha inks over
 * their true backdrops, and asserts the WCAG floors the Foundation values were
 * solved to. If a future token re-tint regresses below 4.5:1 this test fails
 * before it ships.
 *
 * mf-text-3 was solved to *exactly* 4.5:1 worst-case (light glass), so the
 * threshold is 4.49 to absorb float noise rather than flake on the boundary.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const WCAG_MIN = 4.49;

const css = readFileSync(new URL('../globals.css', import.meta.url), 'utf8');

type Decls = Record<string, string>;

/** Parse every top-level rule into { selector -> { --token: value } }, comments stripped. */
function parseRules(source: string): Map<string, Decls> {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = new Map<string, Decls>();
  let depth = 0;
  let buf = '';
  let selector = '';
  for (const ch of clean) {
    if (ch === '{') {
      // A top-level rule's selector is the text after any preceding statement
      // terminator (e.g. the leading `@import "tailwindcss";` before `:root`).
      if (depth === 0) selector = buf.split(';').pop()!.trim().replace(/\s+/g, ' ');
      depth += 1;
      buf = '';
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const decls: Decls = {};
        for (const stmt of buf.split(';')) {
          const m = stmt.match(/^\s*(--[a-z0-9-]+)\s*:\s*(.+?)\s*$/i);
          if (m) decls[m[1]!] = m[2]!.trim();
        }
        const prev = rules.get(selector) ?? {};
        rules.set(selector, { ...prev, ...decls });
      }
      buf = '';
      continue;
    }
    buf += ch;
  }
  return rules;
}

const rules = parseRules(css);

/** Cascade layering per theme (later selectors win); mirrors the globals.css header. */
const THEMES: Record<string, string[]> = {
  'classic-light': [':root'],
  'classic-dark': [':root', '.dark'],
  'ocean-light': [':root', '[data-scheme="ocean"]'],
  'ocean-dark': [':root', '.dark', '[data-scheme="ocean"]', '.dark[data-scheme="ocean"]'],
  'velvet-light': [':root', '[data-scheme="velvet"]'],
  'velvet-dark': [':root', '.dark', '[data-scheme="velvet"]', '.dark[data-scheme="velvet"]'],
};

function resolve(theme: string): Decls {
  const layers = THEMES[theme];
  if (!layers) throw new Error(`unknown theme "${theme}"`);
  const out: Decls = {};
  for (const sel of layers) {
    const decls = rules.get(sel);
    if (!decls) throw new Error(`missing block for selector "${sel}" (theme ${theme})`);
    Object.assign(out, decls);
  }
  return out;
}

/** Read a required token, failing loudly if a re-tint dropped it. */
function req(t: Decls, token: string): string {
  const v = t[token];
  if (v === undefined) throw new Error(`missing token ${token}`);
  return v;
}

type RGBA = { r: number; g: number; b: number; a: number };

function parseColor(value: string): RGBA {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (rgba) {
    return { r: +rgba[1]!, g: +rgba[2]!, b: +rgba[3]!, a: rgba[4] === undefined ? 1 : +rgba[4] };
  }
  throw new Error(`unsupported color value: "${value}"`);
}

/** Composite a (possibly translucent) foreground color over an opaque backdrop. */
function composite(fg: RGBA, bg: RGBA): RGBA {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }: RGBA): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrast(a: RGBA, b: RGBA): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** The three backdrops every readable ink is checked against. */
function backdrops(t: Decls): Record<string, RGBA> {
  const glass = composite(parseColor(req(t, '--mf-glass')), parseColor(req(t, '--mf-window')));
  return {
    glass,
    background: parseColor(req(t, '--background')),
    card: parseColor(req(t, '--card')),
  };
}

const ALL = Object.keys(THEMES);
const LIGHT = ALL.filter((t) => t.endsWith('-light'));

describe('globals.css contrast guardrail', () => {
  it.each(ALL)('muted-foreground clears 4.5:1 on glass/background/card — %s', (theme) => {
    const t = resolve(theme);
    const ink = parseColor(req(t, '--muted-foreground'));
    for (const [name, bg] of Object.entries(backdrops(t))) {
      expect(contrast(ink, bg), `muted-foreground on ${name} (${theme})`).toBeGreaterThanOrEqual(WCAG_MIN);
    }
  });

  it.each(ALL)('mf-text-3 clears 4.5:1 on glass/background/card — %s', (theme) => {
    const t = resolve(theme);
    const ink = parseColor(req(t, '--mf-text-3'));
    for (const [name, bg] of Object.entries(backdrops(t))) {
      expect(contrast(ink, bg), `mf-text-3 on ${name} (${theme})`).toBeGreaterThanOrEqual(WCAG_MIN);
    }
  });

  it.each(LIGHT)('mf-success/mf-warning clear 4.5:1 as text on background — %s', (theme) => {
    const t = resolve(theme);
    const bg = parseColor(req(t, '--background'));
    expect(
      contrast(parseColor(req(t, '--mf-success')), bg),
      `mf-success on background (${theme})`,
    ).toBeGreaterThanOrEqual(WCAG_MIN);
    expect(
      contrast(parseColor(req(t, '--mf-warning')), bg),
      `mf-warning on background (${theme})`,
    ).toBeGreaterThanOrEqual(WCAG_MIN);
  });

  it('resolves ocean/velvet light background by inheritance from :root', () => {
    // Guards the cascade model itself: these blocks do NOT redeclare --background.
    expect(resolve('ocean-light')['--background']).toBe('#ffffff');
    expect(resolve('velvet-light')['--background']).toBe('#ffffff');
  });
});
