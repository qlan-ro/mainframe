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
