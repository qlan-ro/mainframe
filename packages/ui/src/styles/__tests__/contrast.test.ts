// @vitest-environment node
/**
 * Contrast guardrail — the CI encoding of the typography/legibility audit
 * (docs/research/2026-07-11-typography-legibility-audit.md §7), repointed at
 * the v2 token layer on 2026-08-06.
 *
 * It read `src/styles/globals.css` until then. That sheet was deleted with the v1
 * shell, so the suite had been failing to even load — no colour token added since
 * has been checked. Hence the source-integrity test below: an ENOENT is loud but
 * a sheet that still exists while the tokens move elsewhere is not, and that is
 * the failure mode that actually bit.
 *
 * Two themes now, not six: the ocean/velvet schemes and the window styles retired
 * with the v2 merge. The sheets layer per theme exactly as the app loads them: the
 * two that `app.css` imports, in its order, then `app.css`'s own rules — it
 * re-points light tokens of its own (`:root:not(.dark)`), which the app paints and
 * this suite missed until 2026-11-24. `.dark` lands on the same element as `:root`
 * in the real app, so a `var()` alias resolves to the DARK value there — which is
 * why the resolver keeps var() lazy.
 *
 * Measured floors at the time of writing (contrast ratios, light / dark):
 *   foreground on background 12.63 / 15.57 · on card 12.63 / 14.10
 *   muted-foreground on background 4.95 / 7.66 · on card 4.95 / 6.94 · on sidebar 4.54 / 5.56
 *   warning as text on background 5.37 / 10.11
 *   foreground on bubble-tinted 11.17 / 9.93   (paled 2026-08-15, still clears by a wide margin)
 *   primary-foreground on primary 3.65 / 3.65  (system blue cannot reach AA)
 *   success on background 3.39 / 9.50          (a glyph/dot hue, never body text)
 *   fail as text on background 5.43 / 6.72 · on its 6% tint, worst surface 4.60 / 4.96
 *   focus on background 4.86 / 5.82
 *
 * `--mf-glass` is gone (2026-08-07): its one consumer, the deleted `layout/SurfaceDragLayer`,
 * is on `bg-background/85` now, so the chip's worst case is `foreground` over
 * `background` — already covered by the first guardrail below.
 *
 * The colour resolver in `./css-color` is verified against Chromium's own
 * `getComputedStyle` + canvas readback for every token here (33/34 exact, the
 * remainder premultiplied-alpha readback noise at α=0.1).
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { composite, contrast, parseRules, resolveOklch, toRgba, type Decls, type RGBA } from './css-color';

// These walk the whole source tree; a loaded machine needs more than the 5s default.
vi.setConfig({ testTimeout: 30_000 });

/** muted-foreground sits at *exactly* 4.5:1 worst-case, so absorb float noise. */
const WCAG_MIN = 4.49;

/* SC 1.4.11 (non-text/UI) and the large-text bar are 3:1. #0a84ff on white is
   3.65:1 — macOS system blue cannot reach AA-normal-text with white ink. */
const UI_COMPONENT_MIN = 3.0;

/** The strongest `bg-fail` tint, in percent, that may sit under `text-fail`. */
const FAIL_TEXT_TINT = 6;

/** The app's entry sheet: what it imports, in order, is the token cascade. */
const ENTRY_SHEET = 'styles/app.css';
const V2_SHEET = 'styles/globals.css';
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

/** The entry sheet's own imports, then the entry sheet. */
function cascade(): { name: string; rules: Map<string, Decls> }[] {
  const entry = readSheet(ENTRY_SHEET);
  const imported = [...entry.matchAll(/^@import '\.\/([\w-]+\.css)';/gm)].map(([, file]) => `styles/${file}`);
  return [...imported, ENTRY_SHEET].map((name) => ({ name, rules: parseRules(readSheet(name)) }));
}

const SHEETS = cascade();
const sheets = {
  v2: SHEETS.find((sheet) => sheet.name === V2_SHEET)!.rules,
  bridge: SHEETS.find((sheet) => sheet.name === BRIDGE_SHEET)!.rules,
  entry: SHEETS[SHEETS.length - 1]!.rules,
};

function uiSources(): { rel: string; text: string }[] {
  const root = new URL('../../', import.meta.url);
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((rel) => /\.tsx?$/.test(rel) && !rel.includes('__tests__'))
    .map((rel) => ({ rel, text: readFileSync(new URL(rel, root), 'utf8') }));
}

/**
 * The selectors that match `<html>` per theme, by rising specificity:
 * `:root:not(.dark)` beats `:root` whatever the order of the sheets.
 */
const THEME_LAYERS: Record<string, string[]> = {
  light: [':root', ':root:not(.dark)'],
  dark: [':root', '.dark'],
};

function resolve(theme: string): Decls {
  const layers = THEME_LAYERS[theme];
  if (!layers) throw new Error(`unknown theme "${theme}"`);
  const out: Decls = {};
  for (const sel of layers) {
    // A selector absent from one sheet is normal — the bridge has no @theme block.
    for (const { rules } of SHEETS) Object.assign(out, rules.get(sel) ?? {});
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
  it('follows the app’s entry sheet, overrides included', () => {
    expect(SHEETS.map((sheet) => sheet.name)).toEqual([V2_SHEET, BRIDGE_SHEET, ENTRY_SHEET]);
    // Every token the entry sheet sets on the root must reach the cascade; a new
    // selector there would be skipped in silence.
    const known = new Set(Object.values(THEME_LAYERS).flat());
    const unread = [...sheets.entry].filter(
      ([selector, decls]) => selector.startsWith(':root') && Object.keys(decls).length > 0 && !known.has(selector),
    );
    expect(unread.map(([selector]) => selector)).toEqual([]);
    expect(resolve('light')['--sidebar-accent']).toBe('#ededf0');
    expect(resolve('dark')['--sidebar-accent']).toBe('#262628');
  });

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

  it.each(THEMES)('a session row stays readable on every fill it wears — %s', (theme) => {
    // The session list sits on `background` (AppSidebar re-points `--sidebar`);
    // hover and selection are `sidebar-accent`, at 60% and full strength.
    const t = resolve(theme);
    const ground = color(t, '--background');
    const accent = color(t, '--sidebar-accent');
    const ink = color(t, '--sidebar-foreground');
    const at = (c: RGBA, a: number): RGBA => ({ ...c, a: c.a * a });
    const rest = [ground];
    // Half strength is the row of the chat visible in the split's other zone.
    const filled = [
      ...[0.5, 0.6, 1].map((strength) => composite(at(accent, strength), ground)),
      composite(color(t, '--chrome-selected'), ground),
    ];
    for (const bg of [...rest, ...filled]) {
      expect(inkOn(at(ink, 0.85), bg), `title (${theme})`).toBeGreaterThanOrEqual(WCAG_MIN);
      expect(inkOn(color(t, '--muted-foreground'), bg), `time (${theme})`).toBeGreaterThanOrEqual(WCAG_MIN);
      expect(inkOn(color(t, '--warning'), bg), `needs you (${theme})`).toBeGreaterThanOrEqual(WCAG_MIN);
      expect(inkOn(color(t, '--primary'), bg), `spinner (${theme})`).toBeGreaterThanOrEqual(3);
      const tile = composite(at(ink, 0.08), bg);
      expect(inkOn(at(ink, 0.75), tile), `project letter (${theme})`).toBeGreaterThanOrEqual(WCAG_MIN);
    }
  });

  it('the row’s time keeps its ink on every fill, and the hover card’s links are body ink', () => {
    const status = readSheet('features/sessions/SessionRowStatus.tsx');
    expect(status).toContain('text-muted-foreground');
    expect(status).not.toContain('text-sidebar-foreground/');
    // `primary` is 3.65:1 in light, and the card's text is 11px.
    expect(readSheet('features/sessions/SessionMetaCard.tsx')).not.toMatch(/text-primary\b/);
  });

  it.each(THEMES)('warning — the caution ink — clears 4.5:1 as TEXT — %s', (theme) => {
    // Unlike success/destructive this one IS body text: the composer edit banner,
    // git divergence and worktree rows all render `text-warning`.
    const t = resolve(theme);
    const ink = color(t, '--warning');
    for (const name of ['background', 'card', 'sidebar'] as const) {
      expect(inkOn(ink, backdrops(t)[name]!), `warning on ${name} (${theme})`).toBeGreaterThanOrEqual(WCAG_MIN);
    }
  });

  it.each(THEMES)('fail — the failed-work ink — clears 4.5:1 as TEXT — %s', (theme) => {
    // Error labels, failed tool rows and failed counts are `text-fail` (S6).
    const t = resolve(theme);
    for (const [name, bg] of Object.entries(backdrops(t))) {
      expect(inkOn(color(t, '--fail'), bg), `fail on ${name} (${theme})`).toBeGreaterThanOrEqual(WCAG_MIN);
    }
  });

  it.each(THEMES)('fail text clears 4.5:1 on its own tint and on muted — %s', (theme) => {
    const t = resolve(theme);
    const fail = color(t, '--fail');
    const muted = color(t, '--muted');
    expect(inkOn(fail, muted), `fail on muted (${theme})`).toBeGreaterThanOrEqual(WCAG_MIN);
    const surfaces: Record<string, RGBA> = {
      ...backdrops(t),
      // The transcript's link chip is `bg-muted/60`; in light the full muted grey carries tints too.
      chip: composite({ ...muted, a: 0.6 }, color(t, '--background')),
      ...(theme === 'light' ? { muted } : {}),
    };
    for (const [name, bg] of Object.entries(surfaces)) {
      const tint = composite({ ...fail, a: FAIL_TEXT_TINT / 100 }, bg);
      expect(inkOn(fail, tint), `fail on its ${FAIL_TEXT_TINT}% tint over ${name} (${theme})`).toBeGreaterThanOrEqual(
        WCAG_MIN,
      );
    }
  });

  it('no rose text is faded, and no tint under rose text is stronger than the one measured', () => {
    const faded: string[] = [];
    const strong: string[] = [];
    for (const { rel, text } of uiSources()) {
      for (const [match] of text.matchAll(/(?<![\w/-])(?:[\w-]+[:/])*text-fail\/[\d[][^\s'"`]*/g))
        faded.push(`${rel}: ${match}`);
      for (const [, prefix, percent, fraction] of text.matchAll(
        /((?:[\w-]+(?:\[[^\]]*\])?(?:\/[\w-]+)?:)*)bg-fail\/(?:(\d+)|\[([\d.]+)\])/g,
      )) {
        const strength = percent !== undefined ? Number(percent) : Number(fraction) * 100;
        if (strength > FAIL_TEXT_TINT && !prefix!.includes('hover:')) strong.push(`${rel}: bg-fail/${strength}`);
      }
    }
    expect(faded).toEqual([]);
    expect(strong.sort()).toEqual([
      // Icons (3:1) and `text-foreground`; no rose text on any of them.
      'components/ui/attachment.tsx: bg-fail/10',
      'features/automations/fields/TokenChip.tsx: bg-fail/10',
      'features/automations/run/status-meta.ts: bg-fail/14',
      'features/chat/workflow/WorkflowRunPanelHeader.tsx: bg-fail/10',
      'features/daemon/pairing-shared.tsx: bg-fail/10',
      'features/shared/ErrorState.tsx: bg-fail/10',
    ]);
  });

  it.each(THEMES)('the focus line clears 3:1 against every surface and the hairline — %s', (theme) => {
    const t = resolve(theme);
    const focus = color(t, '--focus');
    expect(focus.a, `the focus line is solid (${theme})`).toBe(1);
    for (const [name, bg] of Object.entries(backdrops(t))) {
      expect(inkOn(focus, bg), `focus on ${name} (${theme})`).toBeGreaterThanOrEqual(UI_COMPONENT_MIN);
      const hairline = composite(color(t, '--border'), bg);
      expect(contrast(focus, hairline), `focus on the hairline over ${name} (${theme})`).toBeGreaterThanOrEqual(
        UI_COMPONENT_MIN,
      );
    }
  });

  it.each(THEMES)('primary clears the 3:1 UI floor as ink on sidebar and background — %s', (theme) => {
    // `primary` doubles as running/selected (D26) and, since the redesign,
    // short glyph-adjacent text too: the sidebar Tasks rows and the panel's
    // Tasks section render `#<n>` in `text-primary` (TaskSidebarRow,
    // TasksSection). Same system-blue ceiling as `primary-foreground` on
    // `primary` below (measured ~3.50 / 3.93, light/dark) — it cannot reach
    // the 4.5:1 text floor, so this guardrail holds it to the 3:1 UI floor
    // like the other semantic hues, not full text AA.
    const t = resolve(theme);
    const ink = color(t, '--primary');
    for (const name of ['sidebar', 'background'] as const) {
      expect(inkOn(ink, backdrops(t)[name]!), `primary on ${name} (${theme})`).toBeGreaterThanOrEqual(UI_COMPONENT_MIN);
    }
  });

  it.each(THEMES)('the semantic hues clear the 3:1 UI floor — %s', (theme) => {
    const t = resolve(theme);
    // These carry meaning on a dot, glyph or tint — never on body text, per the
    // design system. So the UI floor, not the text floor, is the right bar.
    for (const token of ['--success', '--warning', '--fail', '--destructive']) {
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

  it.each(THEMES)('rings are the focus blue, and selection is built from the accent — %s', (theme) => {
    const t = resolve(theme);
    expect(color(t, '--ring'), `ring should be focus (${theme})`).toEqual(color(t, '--focus'));
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
