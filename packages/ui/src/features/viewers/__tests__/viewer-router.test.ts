/**
 * viewer-router tests — pickViewerKind pure function.
 *
 * Each test hardcodes the expected kind; no logic mirrors the implementation.
 * Covers: every supported image extension, svg, csv, pdf, code/text,
 * and the code-fallthrough paths.
 */
import { describe, expect, it } from 'vitest';
import { pickViewerKind } from '../viewer-router';

describe('pickViewerKind', () => {
  // Image extensions
  it('returns "image" for .png', () => {
    expect(pickViewerKind('/path/to/hero.png')).toBe('image');
  });

  it('returns "image" for .jpg', () => {
    expect(pickViewerKind('/path/to/photo.jpg')).toBe('image');
  });

  it('returns "image" for .jpeg', () => {
    expect(pickViewerKind('/path/to/photo.jpeg')).toBe('image');
  });

  it('returns "image" for .gif', () => {
    expect(pickViewerKind('/path/to/anim.gif')).toBe('image');
  });

  it('returns "image" for .webp', () => {
    expect(pickViewerKind('/path/to/banner.webp')).toBe('image');
  });

  it('returns "image" for uppercase extension .PNG', () => {
    expect(pickViewerKind('/path/to/LOGO.PNG')).toBe('image');
  });

  // SVG
  it('returns "svg" for .svg', () => {
    expect(pickViewerKind('/icons/logo.svg')).toBe('svg');
  });

  it('returns "svg" for uppercase .SVG', () => {
    expect(pickViewerKind('/icons/logo.SVG')).toBe('svg');
  });

  // CSV
  it('returns "csv" for .csv', () => {
    expect(pickViewerKind('/data/metrics.csv')).toBe('csv');
  });

  it('returns "csv" for uppercase .CSV', () => {
    expect(pickViewerKind('/data/METRICS.CSV')).toBe('csv');
  });

  // PDF
  it('returns "pdf" for .pdf', () => {
    expect(pickViewerKind('/docs/spec.pdf')).toBe('pdf');
  });

  it('returns "pdf" for uppercase .PDF', () => {
    expect(pickViewerKind('/docs/SPEC.PDF')).toBe('pdf');
  });

  // Code / text — should fall through to "code"
  it('returns "code" for .ts', () => {
    expect(pickViewerKind('/src/index.ts')).toBe('code');
  });

  it('returns "code" for .tsx', () => {
    expect(pickViewerKind('/src/App.tsx')).toBe('code');
  });

  it('returns "code" for .js', () => {
    expect(pickViewerKind('/src/util.js')).toBe('code');
  });

  it('returns "code" for .py', () => {
    expect(pickViewerKind('/src/main.py')).toBe('code');
  });

  it('returns "code" for .rs', () => {
    expect(pickViewerKind('/src/lib.rs')).toBe('code');
  });

  it('returns "code" for .json', () => {
    expect(pickViewerKind('/config.json')).toBe('code');
  });

  it('returns "code" for .md', () => {
    expect(pickViewerKind('/README.md')).toBe('code');
  });

  it('returns "code" for .txt (no CM6 pack, rendered as plaintext)', () => {
    expect(pickViewerKind('/notes.txt')).toBe('code');
  });

  it('returns "code" for a file with no extension', () => {
    expect(pickViewerKind('/usr/local/bin/Makefile')).toBe('code');
  });

  it('returns "code" for unknown binary-ish extension like .zip', () => {
    // zip has no viewer; the router falls through to "code" (CmEditor shows raw)
    expect(pickViewerKind('/archive.zip')).toBe('code');
  });
});
