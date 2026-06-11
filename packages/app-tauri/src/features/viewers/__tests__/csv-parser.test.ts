import { describe, expect, it } from 'vitest';
import { parseCsv } from '../csv-parser';

describe('parseCsv — RFC 4180 field handling', () => {
  it('keeps a trailing empty field after a final comma', () => {
    const { headers, rows } = parseCsv('a,b,c\n1,2,');
    expect(headers).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual([['1', '2', '']]);
  });

  it('keeps an empty field between two commas', () => {
    const { rows } = parseCsv('a,b,c\n1,,3');
    expect(rows).toEqual([['1', '', '3']]);
  });

  it('parses quoted fields with embedded commas', () => {
    const { rows } = parseCsv('a,b\n"x,y",z');
    expect(rows).toEqual([['x,y', 'z']]);
  });

  it('handles CRLF and bare CR line endings', () => {
    expect(parseCsv('a,b\r\n1,2').rows).toEqual([['1', '2']]);
    expect(parseCsv('a,b\r1,2').rows).toEqual([['1', '2']]);
  });
});
