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
  it('keeps production UI free of raw color literals outside the token contract', () => {
    const offenders = productionSources().flatMap(({ rel, text }) => {
      const matches = text.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g) ?? [];
      return matches.map((match) => `${rel}: ${match}`);
    });

    expect(offenders).toEqual([]);
  });

  it('uses named typography tokens instead of arbitrary or framework-default values', () => {
    const offenders = productionSources().flatMap(({ rel, text }) => {
      const matches =
        text.match(
          /(?:text|tracking|leading)-\[[^\]]+\]|\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b|\btracking-(?!normal\b)[a-z-]+/g,
        ) ?? [];
      return matches.map((match) => `${rel}: ${match}`);
    });

    expect(offenders).toEqual([]);
  });
});
