/**
 * Streamdown puts its own utilities on the markdown root. Tailwind does not
 * scan node_modules, so they generate no CSS, and the transcript's spacing comes
 * from the component map alone. Writing one of them anywhere in `src` would make
 * Tailwind generate it and re-space every reply.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT_UTILITIES = ['space-y-4', '[&>*:first-child]:mt-0', '[&>*:last-child]:mb-0'];
const SRC = join(__dirname, '../../../..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe("Streamdown's root utilities", () => {
  // Reads every source file: slow when the whole suite shares the machine.
  it('are used nowhere in src, so Tailwind never generates them', { timeout: 30_000 }, () => {
    const hits = sources(SRC).flatMap((path) => {
      const text = readFileSync(path, 'utf8');
      return ROOT_UTILITIES.filter((cls) => text.includes(cls)).map((cls) => `${path}: ${cls}`);
    });
    expect(hits).toEqual([]);
  });
});
