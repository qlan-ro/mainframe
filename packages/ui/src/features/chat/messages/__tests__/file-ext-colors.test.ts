import { describe, expect, it } from 'vitest';
import { extTint, fileExtMeta } from '../file-ext-colors';

/** The grey every unmapped extension falls back to. */
const FALLBACK_COLOR = 'oklch(0.56 0.01 286)';

describe('fileExtMeta', () => {
  it('lowercases the extension off the last dot', () => {
    expect(fileExtMeta('Report.PDF').ext).toBe('pdf');
    expect(fileExtMeta('archive.tar.gz').ext).toBe('gz');
  });

  it('reads pdf as its own type', () => {
    expect(fileExtMeta('report.pdf')).toEqual({ ext: 'pdf', color: 'oklch(0.55 0.19 27)', label: 'PDF' });
  });

  it('reads txt as its own type', () => {
    expect(fileExtMeta('notes.txt')).toEqual({ ext: 'txt', color: 'oklch(0.60 0.05 230)', label: 'Text file' });
  });

  it('gives log a colour of its own, not the fallback grey', () => {
    expect(fileExtMeta('daemon.log')).toEqual({ ext: 'log', color: 'oklch(0.58 0.11 320)', label: 'Log file' });
  });

  // The point of the three additions: a tile whose type we know must never look
  // like a tile whose type we don't.
  it.each(['report.pdf', 'notes.txt', 'daemon.log'])('%s is visually distinct from an unknown file', (name) => {
    expect(fileExtMeta(name).color).not.toBe(FALLBACK_COLOR);
  });

  it('gives the three new types three different colours', () => {
    const colors = ['report.pdf', 'notes.txt', 'daemon.log'].map((n) => fileExtMeta(n).color);
    expect(new Set(colors).size).toBe(3);
  });

  it('falls back to the grey "File" meta for an unmapped extension', () => {
    expect(fileExtMeta('mystery.xyz')).toEqual({ ext: 'xyz', color: FALLBACK_COLOR, label: 'File' });
  });

  it('falls back for a name with no extension at all', () => {
    expect(fileExtMeta('Makefile')).toEqual({ ext: 'makefile', color: FALLBACK_COLOR, label: 'File' });
  });
});

describe('extTint', () => {
  it('wraps a colour in a 12% srgb mix toward transparent', () => {
    expect(extTint('oklch(0.55 0.19 27)')).toBe('color-mix(in srgb, oklch(0.55 0.19 27) 12%, transparent)');
  });
});
