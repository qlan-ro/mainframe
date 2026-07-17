// @vitest-environment jsdom
/**
 * viewer-router tests — pickViewerKind pure function.
 *
 * Each case hardcodes the expected kind; no logic mirrors the implementation.
 * Covers: every supported image extension, svg, csv, pdf, code/text,
 * and the code-fallthrough paths.
 */
import { describe, expect, it } from 'vitest';
import { pickViewerKind } from '../viewer-router';

describe('pickViewerKind', () => {
  it.each([
    '/path/to/hero.png',
    '/path/to/photo.jpg',
    '/path/to/photo.jpeg',
    '/path/to/anim.gif',
    '/path/to/banner.webp',
    '/path/to/LOGO.PNG', // uppercase extension
  ])('returns "image" for %s', (path) => {
    expect(pickViewerKind(path)).toBe('image');
  });

  it.each([
    ['svg', '/icons/logo.svg'],
    ['svg', '/icons/logo.SVG'],
    ['csv', '/data/metrics.csv'],
    ['csv', '/data/METRICS.CSV'],
    ['pdf', '/docs/spec.pdf'],
    ['pdf', '/docs/SPEC.PDF'],
  ] as const)('returns "%s" for %s', (kind, path) => {
    expect(pickViewerKind(path)).toBe(kind);
  });

  // Code / text — should fall through to "code". Includes .txt (no CM6 pack,
  // rendered as plaintext), extensionless files, and unknown binary-ish
  // extensions like .zip (no viewer; CmEditor shows raw).
  it.each([
    '/src/index.ts',
    '/src/App.tsx',
    '/src/util.js',
    '/src/main.py',
    '/src/lib.rs',
    '/config.json',
    '/README.md',
    '/notes.txt',
    '/usr/local/bin/Makefile',
    '/archive.zip',
  ])('returns "code" for %s', (path) => {
    expect(pickViewerKind(path)).toBe('code');
  });
});
