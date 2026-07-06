import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatCsvStatus,
  formatImageStatus,
  formatMarkdownStatus,
  formatPdfStatus,
  formatSvgStatus,
  splitSvgStatus,
  splitMarkdownStatus,
} from '../viewer-status';

describe('formatBytes', () => {
  it('formats bytes under 1 MB as integer KB with no decimal', () => {
    expect(formatBytes(253952)).toBe('248 KB');
  });

  it('formats bytes >= 1 MB as one decimal MB', () => {
    expect(formatBytes(1258291)).toBe('1.2 MB');
  });

  it('formats small byte count as KB with no decimal', () => {
    expect(formatBytes(410)).toBe('0.4 KB');
  });
});

describe('formatImageStatus', () => {
  it('formats image status with uppercased ext, dimensions, and size', () => {
    expect(formatImageStatus({ ext: 'png', w: 1840, h: 1024, bytes: 253952 })).toBe('PNG · 1840×1024 · 248 KB');
  });
});

describe('formatCsvStatus', () => {
  it('formats CSV status with row and col counts', () => {
    expect(formatCsvStatus({ rows: 12, cols: 4 })).toBe('CSV · UTF-8 · 12 rows · 4 cols');
  });
});

describe('formatMarkdownStatus', () => {
  it('formats markdown status with word and line counts', () => {
    expect(formatMarkdownStatus({ words: 320, lines: 88 })).toBe('Markdown · 320 words · 88 lines');
  });
});

describe('formatPdfStatus', () => {
  it('formats PDF status with page count and size', () => {
    expect(formatPdfStatus({ pages: 5, bytes: 1258291 })).toBe('PDF · 5 pages · 1.2 MB');
  });
});

describe('formatSvgStatus', () => {
  it('formats SVG status with viewBox, dimensions, and size', () => {
    expect(formatSvgStatus({ viewBox: '0 0 96 96', w: 96, h: 96, bytes: 410 })).toBe(
      'SVG · viewBox 0 0 96 96 · 96×96 · 0.4 KB',
    );
  });
});

describe('splitSvgStatus', () => {
  it('splits SVG status into left (SVG · viewBox) and right (dimensions · size)', () => {
    const result = splitSvgStatus({ viewBox: '0 0 96 96', w: 96, h: 96, bytes: 410 });
    expect(result.left).toBe('SVG · viewBox 0 0 96 96');
    expect(result.right).toBe('96×96 · 0.4 KB');
  });
});

describe('splitMarkdownStatus', () => {
  it('returns left="Markdown · UTF-8" and right with word/line counts', () => {
    const result = splitMarkdownStatus(320, 88);
    expect(result.left).toBe('Markdown · UTF-8');
    expect(result.right).toBe('320 words · 88 lines');
  });

  it('handles zero word/line counts', () => {
    const result = splitMarkdownStatus(0, 0);
    expect(result.left).toBe('Markdown · UTF-8');
    expect(result.right).toBe('0 words · 0 lines');
  });
});
