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

/* #0a84ff on white is 3.65:1 — macOS system blue cannot reach AA-normal-text
   with a white foreground; SC 1.4.11 (non-text/UI) and large-text bar is 3:1. */
const UI_COMPONENT_MIN = 3.0;

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

/** Pull the rgba(...) call out of a shorthand value like a box-shadow. */
function extractRgba(shorthand: string): string {
  const m = shorthand.match(/rgba?\([^)]+\)/i);
  if (!m) throw new Error(`no rgba()/rgb() found in "${shorthand}"`);
  return m[0];
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

  it.each(ALL)('primary-foreground clears 3:1 as ink on --primary fill — %s', (theme) => {
    const t = resolve(theme);
    const fg = parseColor(req(t, '--primary-foreground'));
    const bg = parseColor(req(t, '--primary'));
    expect(contrast(fg, bg), `primary-foreground on primary (${theme})`).toBeGreaterThanOrEqual(UI_COMPONENT_MIN);
  });

  it('classic-dark accent stays legible as ink on its three backdrops', () => {
    const t = resolve('classic-dark');
    const ink = parseColor(req(t, '--primary'));
    for (const [name, bg] of Object.entries(backdrops(t))) {
      expect(contrast(ink, bg), `primary as ink on ${name} (classic-dark)`).toBeGreaterThanOrEqual(UI_COMPONENT_MIN);
    }
  });
});

describe('globals.css accent derivation', () => {
  // Todo #277's literal acceptance criterion: classic-light and classic-dark
  // share one accent. Pinning both halves also guards "light is unchanged".
  const MACOS_SYSTEM_BLUE = '#0a84ff';

  it('classic-light and classic-dark --primary are macOS system blue', () => {
    expect(resolve('classic-light')['--primary']).toBe(MACOS_SYSTEM_BLUE);
    expect(resolve('classic-dark')['--primary']).toBe(MACOS_SYSTEM_BLUE);
  });

  it.each(ALL)('--mf-selection carries --primary RGB (alpha differs per theme by design) — %s', (theme) => {
    const t = resolve(theme);
    const primary = parseColor(req(t, '--primary'));
    const selection = parseColor(req(t, '--mf-selection'));
    expect([selection.r, selection.g, selection.b]).toEqual([primary.r, primary.g, primary.b]);
  });

  it.each(ALL)('--mf-focus-ring carries --primary RGB (alpha differs per theme by design) — %s', (theme) => {
    const t = resolve(theme);
    const primary = parseColor(req(t, '--primary'));
    const ring = parseColor(extractRgba(req(t, '--mf-focus-ring')));
    expect([ring.r, ring.g, ring.b]).toEqual([primary.r, primary.g, primary.b]);
  });

  it('classic-dark --mf-cm-selection/-focused carry --primary RGB (matches ocean/velvet dark pattern)', () => {
    const t = resolve('classic-dark');
    const primary = parseColor(req(t, '--primary'));
    for (const token of ['--mf-cm-selection', '--mf-cm-selection-focused']) {
      const c = parseColor(req(t, token));
      expect([c.r, c.g, c.b], token).toEqual([primary.r, primary.g, primary.b]);
    }
  });

  const DIRECTIVE_TINT_THEMES = ['classic-light', 'classic-dark', 'ocean-dark', 'velvet-dark'];
  it.each(DIRECTIVE_TINT_THEMES)('--mf-directive-command-tint carries --primary RGB — %s', (theme) => {
    const t = resolve(theme);
    const primary = parseColor(req(t, '--primary'));
    const tint = parseColor(req(t, '--mf-directive-command-tint'));
    expect([tint.r, tint.g, tint.b]).toEqual([primary.r, primary.g, primary.b]);
  });

  it('ocean-light and velvet-light inherit --mf-directive-command-tint from :root (classic blue, not their own accent)', () => {
    const classicTint = resolve('classic-light')['--mf-directive-command-tint'];
    expect(resolve('ocean-light')['--mf-directive-command-tint']).toBe(classicTint);
    expect(resolve('velvet-light')['--mf-directive-command-tint']).toBe(classicTint);
  });
});
