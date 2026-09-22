import { describe, expect, it } from 'vitest';
import { parseCsv, sliceCsvRowSource } from '../csv-parser';
import { MAX_INLINE_LINES } from '@/features/editor/inline-comments/resolve-comment-range';

/** Extract the cells arrays from CsvRow[] for backward-compatible assertions. */
function rowCells(rows: ReturnType<typeof parseCsv>['rows']): string[][] {
  return rows.map((r) => r.cells);
}

describe('parseCsv — RFC 4180 field handling', () => {
  it('keeps a trailing empty field after a final comma', () => {
    const { headers, rows } = parseCsv('a,b,c\n1,2,');
    expect(headers).toEqual(['a', 'b', 'c']);
    expect(rowCells(rows)).toEqual([['1', '2', '']]);
  });

  it('keeps an empty field between two commas', () => {
    const { rows } = parseCsv('a,b,c\n1,,3');
    expect(rowCells(rows)).toEqual([['1', '', '3']]);
  });

  it('parses quoted fields with embedded commas', () => {
    const { rows } = parseCsv('a,b\n"x,y",z');
    expect(rowCells(rows)).toEqual([['x,y', 'z']]);
  });

  it('handles CRLF and bare CR line endings', () => {
    expect(rowCells(parseCsv('a,b\r\n1,2').rows)).toEqual([['1', '2']]);
    expect(rowCells(parseCsv('a,b\r1,2').rows)).toEqual([['1', '2']]);
  });

  it('stamps each row with a stable _index from parse order', () => {
    const { rows } = parseCsv('a,b\nZoe,1\nAbe,2\nMae,3');
    expect(rows[0]!._index).toBe(0);
    expect(rows[1]!._index).toBe(1);
    expect(rows[2]!._index).toBe(2);
  });
});

describe('parseCsv — source line ranges', () => {
  it('stamps every row with its startLine and endLine', () => {
    const { rows } = parseCsv('a,b\n1,2\n3,4');
    expect(rows[0]).toEqual({ cells: ['1', '2'], _index: 0, startLine: 2, endLine: 2 });
    expect(rows[1]).toEqual({ cells: ['3', '4'], _index: 1, startLine: 3, endLine: 3 });
  });

  it('spans the real source lines of a quoted field with an embedded newline', () => {
    const { rows } = parseCsv('a,b\n1,2\n"x\ny",z\n5,6');
    expect(rows[1]).toEqual({ cells: ['x\ny', 'z'], _index: 1, startLine: 3, endLine: 4 });
    expect(rows[2]).toEqual({ cells: ['5', '6'], _index: 2, startLine: 5, endLine: 5 });
  });

  it('numbers rows identically whether the file uses LF line endings', () => {
    const { rows } = parseCsv('a,b\n1,2\n3,4');
    expect(rows).toEqual([
      { cells: ['1', '2'], _index: 0, startLine: 2, endLine: 2 },
      { cells: ['3', '4'], _index: 1, startLine: 3, endLine: 3 },
    ]);
  });

  it('numbers rows identically whether the file uses CRLF line endings', () => {
    const { rows } = parseCsv('a,b\r\n1,2\r\n3,4');
    expect(rows).toEqual([
      { cells: ['1', '2'], _index: 0, startLine: 2, endLine: 2 },
      { cells: ['3', '4'], _index: 1, startLine: 3, endLine: 3 },
    ]);
  });

  it('numbers rows identically whether the file uses bare-CR line endings', () => {
    const { rows } = parseCsv('a,b\r1,2\r3,4');
    expect(rows).toEqual([
      { cells: ['1', '2'], _index: 0, startLine: 2, endLine: 2 },
      { cells: ['3', '4'], _index: 1, startLine: 3, endLine: 3 },
    ]);
  });

  it('pushes the header past two leading blank lines', () => {
    const { headers } = parseCsv('\n\na,b\n1,2');
    expect(headers).toEqual(['a', 'b']);
  });

  it('pushes the first data row to line 4 behind two leading blank lines', () => {
    const { rows } = parseCsv('\n\na,b\n1,2');
    expect(rows).toEqual([{ cells: ['1', '2'], _index: 0, startLine: 4, endLine: 4 }]);
  });

  it('adds no row for a trailing newline', () => {
    const { rows } = parseCsv('a,b\n1,2\n');
    expect(rows).toEqual([{ cells: ['1', '2'], _index: 0, startLine: 2, endLine: 2 }]);
  });

  it('keeps a mid-file blank line as one empty row at its real line', () => {
    const { rows } = parseCsv('a,b\n1,2\n\n3,4');
    expect(rows).toEqual([
      { cells: ['1', '2'], _index: 0, startLine: 2, endLine: 2 },
      { cells: [''], _index: 1, startLine: 3, endLine: 3 },
      { cells: ['3', '4'], _index: 2, startLine: 4, endLine: 4 },
    ]);
  });

  it('exposes the header row own source line range', () => {
    const { headerRange } = parseCsv('a,b\n1,2');
    expect(headerRange).toEqual({ startLine: 1, endLine: 1 });
  });

  it('pushes the header range past two leading blank lines', () => {
    const { headerRange } = parseCsv('\n\na,b\n1,2');
    expect(headerRange).toEqual({ startLine: 3, endLine: 3 });
  });

  it('spans the header range over an embedded newline in a quoted header field', () => {
    const { headerRange } = parseCsv('"a\nb",c\n1,2');
    expect(headerRange).toEqual({ startLine: 1, endLine: 2 });
  });

  it('reports a null header range for empty input', () => {
    expect(parseCsv('').headerRange).toBeNull();
  });
});

describe('sliceCsvRowSource', () => {
  it('slices the file source lines for a single-line row', () => {
    const text = 'a,b\n1,2\n3,4';
    const { rows } = parseCsv(text);
    expect(sliceCsvRowSource(text, rows[1]!)).toBe('3,4');
  });

  it('slices the file source lines for a multi-line quoted row', () => {
    const text = 'a,b\n1,2\n"x\ny",z\n5,6';
    const { rows } = parseCsv(text);
    expect(rows[1]).toMatchObject({ startLine: 3, endLine: 4 });
    expect(sliceCsvRowSource(text, rows[1]!)).toBe('"x\ny",z');
  });

  it('returns an empty string once the range exceeds MAX_INLINE_LINES', () => {
    const overCap = MAX_INLINE_LINES + 10;
    const bigQuoted = `"${Array.from({ length: overCap }, (_, i) => `line${i}`).join('\n')}",z`;
    const text = `a,b\n${bigQuoted}`;
    const { rows } = parseCsv(text);
    expect(rows[0]!.endLine - rows[0]!.startLine + 1).toBeGreaterThan(MAX_INLINE_LINES);
    expect(sliceCsvRowSource(text, rows[0]!)).toBe('');
  });
});
