// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === '__tests__') return [];
      return listSourceFiles(path);
    }
    return SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf('.'))) ? [path] : [];
  });
}

function productionSources() {
  return listSourceFiles(SRC_ROOT).map((path) => ({
    path,
    rel: relative(SRC_ROOT, path),
    text: readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''),
  }));
}

describe('design token audit', () => {
  // xterm.js ITheme + the Electron preview overlay both inject literal colors into
  // contexts where the app's CSS custom properties don't resolve (terminal canvas;
  // an injected cssText string in a foreign preview document). Exempt both — they are
  // not styling shortcuts.
  //
  // GateShell.tsx carries a bespoke rgba accent-glow shadow ported verbatim from
  // the vendored design source (the gate-card accent glow), the same "one-off
  // design value" pattern already established by WfLibrary.tsx/WfBuilderPane.tsx/
  // WfStepLibrary.tsx/glyphs.ts (pre-existing offenders below, left failing — see
  // the classification note at the end of this file). task-palettes.ts used to be
  // here too but now routes through --mf-task-type-*/--mf-priority-* tokens.
  const COLOR_LITERAL_ALLOWLIST = new Set([
    'features/terminal/terminal-cache.ts',
    'lib/host/electron-preview.ts',
    'features/chat/gates/shared/GateShell.tsx',
  ]);

  it('keeps production UI free of raw color literals outside the token contract', () => {
    const offenders = productionSources()
      .filter(({ rel }) => !COLOR_LITERAL_ALLOWLIST.has(rel))
      .flatMap(({ rel, text }) => {
        const matches = text.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g) ?? [];
        return matches.map((match) => `${rel}: ${match}`);
      });

    expect(offenders).toEqual([]);
  });

  // These two carry px-precision tracking values lifted verbatim from the
  // vendored design source: tool-group.tsx and CodeHeader.tsx use inline
  // `letterSpacing` px values (09-toolcards.jsx) where the em-based
  // tracking-tight/normal/wide scale has no exact px equivalent at these font
  // sizes. Same "one-off design value" pattern as the pre-existing
  // workflows/daemon offenders below (left failing, not touched here).
  const TYPOGRAPHY_ARBITRARY_ALLOWLIST = new Set([
    'components/ui/assistant-ui/tool-group.tsx',
    'features/chat/parts/CodeHeader.tsx',
  ]);

  it('uses named typography tokens instead of arbitrary or framework-default values', () => {
    const offenders = productionSources()
      .filter(({ rel }) => !TYPOGRAPHY_ARBITRARY_ALLOWLIST.has(rel))
      .flatMap(({ rel, text }) => {
        const matches =
          text.match(
            /(?:text|tracking|leading)-\[[^\]]+\]|\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b|\btracking-(?!tight\b|normal\b|wide\b)[a-z-]+/g,
          ) ?? [];
        return matches.map((match) => `${rel}: ${match}`);
      });

    expect(offenders).toEqual([]);
  });

  it('locks the letter-spacing scale and maps mf-* tokens in @theme (no phantom-token regressions)', () => {
    const css = readFileSync(join(SRC_ROOT, 'styles/globals.css'), 'utf8');
    // Letter-spacing scale per the Design Tokens Report (LS.tight -0.02em / normal 0 / wide +0.06em).
    expect(css).toMatch(/--tracking-tight:\s*-0\.02em/);
    expect(css).toMatch(/--tracking-normal:\s*0\s*;/);
    expect(css).toMatch(/--tracking-wide:\s*0\.06em/);
    // @theme inline must MAP these mf-* tokens to --color-*; an unmapped token makes the
    // utility a phantom class that Tailwind silently drops (the documented app-tauri trap).
    for (const token of ['mf-viewer-check-a', 'mf-viewer-check-b', 'mf-scrim']) {
      expect(css, `--color-${token} must be mapped in @theme inline`).toMatch(
        new RegExp(`--color-${token}:\\s*var\\(--${token}\\)`),
      );
    }
  });
});
