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
  // xterm.js ITheme requires literal hex color strings; terminal-cache feeds them via
  // tokenColor(cssVar, hexFallback) so the CSS var wins at runtime but a concrete hex is a
  // mandatory fallback (the theme is built before first paint). Exempt that one file from
  // the raw-color-literal ban — it is not a styling shortcut.
  const COLOR_LITERAL_ALLOWLIST = new Set(['features/terminal/terminal-cache.ts']);

  it('keeps production UI free of raw color literals outside the token contract', () => {
    const offenders = productionSources()
      .filter(({ rel }) => !COLOR_LITERAL_ALLOWLIST.has(rel))
      .flatMap(({ rel, text }) => {
        const matches = text.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g) ?? [];
        return matches.map((match) => `${rel}: ${match}`);
      });

    expect(offenders).toEqual([]);
  });

  it('uses named typography tokens instead of arbitrary or framework-default values', () => {
    const offenders = productionSources().flatMap(({ rel, text }) => {
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
