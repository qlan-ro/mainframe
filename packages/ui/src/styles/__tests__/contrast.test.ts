// @vitest-environment node
/**
 * Contrast guardrail — the CI encoding of the typography/legibility audit
 * (docs/architecture/2026-07-11-typography-legibility-audit.md §7), repointed at
 * the v2 token layer on 2026-08-06.
 *
 * It read `src/styles/globals.css` until then. That sheet was deleted with the v1
 * shell, so the suite had been failing to even load — no colour token added since
 * has been checked. Hence the source-integrity test below: an ENOENT is loud but
 * a sheet that still exists while the tokens move elsewhere is not, and that is
 * the failure mode that actually bit.
 *
 * Two themes now, not six: the ocean/velvet schemes and the window styles retired
 * with the v2 merge, so `:root` and `:root`+`.dark` are the whole cascade. Both
 * sheets layer per theme (v2 first, then the bridge) exactly as `app.css` imports
 * them, and `.dark` lands on the same element as `:root` in the real app, so a
 * a `var()` alias resolves to the DARK
 * value there — which is why the resolver keeps var() lazy.
 *
 * Measured floors at the time of writing (contrast ratios, light / dark):
 *   foreground on background 12.63 / 15.57 · on card 12.63 / 14.10
 *   muted-foreground on background 4.74 / 7.66 · on card 4.74 / 6.94
 *   warning as text on background 5.37 / 10.11
 *   foreground on bubble-tinted 10.03 / 10.72  (matches the Phase-2 ledger)
 *   primary-foreground on primary 3.65 / 3.65  (system blue cannot reach AA)
 *   success on background 3.39 / 9.50          (a glyph/dot hue, never body text)
 *
 * `--mf-glass` is gone (2026-08-07): its one consumer, `layout/SurfaceDragLayer`,
 * is on `bg-background/85` now, so the chip's worst case is `foreground` over
 * `background` — already covered by the first guardrail below.
 *
 * The colour resolver in `./css-color` is verified against Chromium's own
 * `getComputedStyle` + canvas readback for every token here (33/34 exact, the
 * remainder premultiplied-alpha readback noise at α=0.1).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { composite, contrast, parseRules, resolveOklch, toRgba, type Decls, type RGBA } from './css-color';

/** muted-foreground sits at *exactly* 4.5:1 worst-case, so absorb float noise. */
const WCAG_MIN = 4.49;

/* SC 1.4.11 (non-text/UI) and the large-text bar are 3:1. #0a84ff on white is
   3.65:1 — macOS system blue cannot reach AA-normal-text with white ink. */
const UI_COMPONENT_MIN = 3.0;

const V2_SHEET = 'v2/styles/globals.css';
const BRIDGE_SHEET = 'styles/domain-tokens.css';

function readSheet(relative: string): string {
  const url = new URL(`../../${relative}`, import.meta.url);
  try {
    return readFileSync(url, 'utf8');
  } catch {
    throw new Error(
      `contrast guardrail cannot read its token source "${relative}". ` +
        `If the sheet moved, repoint this test — do not delete it; it went inert ` +
        `once already when src/styles/globals.css was removed.`,
    );
  }
}

const sheets = {
  v2: parseRules(readSheet(V2_SHEET)),
  bridge: parseRules(readSheet(BRIDGE_SHEET)),
};

/** Cascade per theme: v2 tokens then the bridge's, `:root` then `.dark`. */
const THEME_LAYERS: Record<string, string[]> = {
  light: [':root'],
  dark: [':root', '.dark'],
};

function resolve(theme: string): Decls {
  const layers = THEME_LAYERS[theme];
  if (!layers) throw new Error(`unknown theme "${theme}"`);
  const out: Decls = {};
  for (const sel of layers) {
    // A selector absent from one sheet is normal — the bridge has no @theme block.
    Object.assign(out, sheets.v2.get(sel) ?? {});
    Object.assign(out, sheets.bridge.get(sel) ?? {});
  }
  return out;
}

/** Read a required token, failing loudly if a re-tint dropped it. */
function req(t: Decls, token: string): string {
  const v = t[token];
  if (v === undefined) throw new Error(`missing token ${token}`);
  return v;
}

function color(t: Decls, token: string): RGBA {
  return toRgba(resolveOklch(req(t, token), (k) => req(t, k)));
}

const THEMES = Object.keys(THEME_LAYERS);

/** The opaque surfaces readable ink actually lands on. */
function backdrops(t: Decls): Record<string, RGBA> {
  return {
    background: color(t, '--background'),
    card: color(t, '--card'),
    popover: color(t, '--popover'),
    sidebar: color(t, '--sidebar'),
  };
}

/** An ink's ratio against a backdrop, compositing it first if it is translucent. */
function inkOn(ink: RGBA, bg: RGBA): number {
  return contrast(composite(ink, bg), bg);
}

describe('token sources', () => {
  it('both sheets parse, and each contributes the tokens this guardrail reads', () => {
    expect(sheets.v2.get(':root'), `${V2_SHEET} has no :root block`).toBeDefined();
    expect(sheets.v2.get('.dark'), `${V2_SHEET} has no .dark block`).toBeDefined();
    expect(sheets.bridge.get(':root'), `${BRIDGE_SHEET} has no :root block`).toBeDefined();

    // Named explicitly so a token migrating between sheets fails HERE, with the
    // sheet named, rather than as a confusing NaN downstream.
    for (const token of ['--background', '--foreground', '--muted-foreground', '--primary', '--bubble-tinted']) {
      expect(sheets.v2.get(':root')![token], `${token} missing from ${V2_SHEET}`).toBeDefined();
    }
    for (const token of ['--mf-code-bg', '--mf-diff-add-bg', '--mf-scrim']) {
      expect(sheets.bridge.get(':root')![token], `${token} missing from ${BRIDGE_SHEET}`).toBeDefined();
    }
  });
});

describe('v2 contrast guardrail', () => {
  it.each(THEMES)('foreground clears 4.5:1 on every surface — %s', (theme) => {
    const t = resolve(theme);
    const ink = color(t, '--foreground');
    for (const [name, bg] of Object.entries(backdrops(t))) {
      expect(inkOn(ink, bg), `foreground on ${name} (${theme})`).toBeGreaterThanOrEqual(WCAG_MIN);
    }
  });

  it.each(THEMES)('muted-foreground clears 4.5:1 on every surface — %s', (theme) => {
    const t = resolve(theme);
    const ink = color(t, '--muted-foreground');
    for (const [name, bg] of Object.entries(backdrops(t))) {
      expect(inkOn(ink, bg), `muted-foreground on ${name} (${theme})`).toBeGreaterThanOrEqual(WCAG_MIN);
    }
  });

  it.each(THEMES)('the user bubble fill carries body ink — %s', (theme) => {
    const t = resolve(theme);
    // The bubble sits on the thread background, and its own fill is opaque there.
    const fill = composite(color(t, '--bubble-tinted'), color(t, '--background'));
    expect(inkOn(color(t, '--foreground'), fill), `foreground on bubble-tinted (${theme})`).toBeGreaterThanOrEqual(
      WCAG_MIN,
    );
  });

  it.each(THEMES)('a selected sidebar row stays readable through its tint — %s', (theme) => {
    const t = resolve(theme);
    const row = composite(color(t, '--sidebar-selection'), color(t, '--sidebar'));
    expect(
      inkOn(color(t, '--sidebar-foreground'), row),
      `sidebar-foreground on sidebar-selection (${theme})`,
    ).toBeGreaterThanOrEqual(WCAG_MIN);
  });

  it.each(THEMES)('warning — the caution ink — clears 4.5:1 as TEXT — %s', (theme) => {
    // Unlike success/destructive this one IS body text: the composer edit banner,
    // git divergence and worktree rows all render `text-warning`.
    const t = resolve(theme);
    const ink = color(t, '--warning');
    for (const name of ['background', 'card'] as const) {
      expect(inkOn(ink, backdrops(t)[name]!), `warning on ${name} (${theme})`).toBeGreaterThanOrEqual(WCAG_MIN);
    }
  });

  it.each(THEMES)('the semantic hues clear the 3:1 UI floor — %s', (theme) => {
    const t = resolve(theme);
    // These carry meaning on a dot, glyph or tint — never on body text, per the
    // design system. So the UI floor, not the text floor, is the right bar.
    for (const token of ['--success', '--warning', '--destructive']) {
      for (const name of ['background', 'card'] as const) {
        expect(inkOn(color(t, token), backdrops(t)[name]!), `${token} on ${name} (${theme})`).toBeGreaterThanOrEqual(
          UI_COMPONENT_MIN,
        );
      }
    }
  });

  it.each(THEMES)('primary-foreground clears 3:1 as ink on the primary fill — %s', (theme) => {
    const t = resolve(theme);
    expect(
      contrast(color(t, '--primary-foreground'), color(t, '--primary')),
      `primary-foreground on primary (${theme})`,
    ).toBeGreaterThanOrEqual(UI_COMPONENT_MIN);
  });
});

describe('v2 token integrity', () => {
  // The bridge's aliases onto v2 tokens are all gone (2026-08-07) — every duplicated
  // semantic was swept into its source at the call sites, so there is no alias left
  // to drift. What remains is the v2 layer's own internal consistency.

  it.each(THEMES)('focus rings and selection are built from the accent — %s', (theme) => {
    const t = resolve(theme);
    expect(color(t, '--ring'), `ring should be primary (${theme})`).toEqual(color(t, '--primary'));
    const selection = color(t, '--sidebar-selection');
    const primary = color(t, '--primary');
    expect([selection.r, selection.g, selection.b], `sidebar-selection hue (${theme})`).toEqual([
      primary.r,
      primary.g,
      primary.b,
    ]);
    expect(selection.a, `sidebar-selection is a tint (${theme})`).toBeLessThan(1);
  });
});
