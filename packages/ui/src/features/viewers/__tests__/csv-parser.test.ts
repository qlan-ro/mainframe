import { describe, expect, it } from 'vitest';
import { parseCsv } from '../csv-parser';

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
});
