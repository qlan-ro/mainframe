/**
 * csv-parser.ts
 *
 * Minimal RFC 4180-compliant CSV parser.
 * Handles: quoted fields (with embedded commas and newlines),
 * escaped double-quotes (two consecutive quotes inside a quoted field),
 * and CRLF + LF line endings.
 *
 * Returns `{ headers, rows }` where both are string[][].
 * Empty input returns empty headers + zero rows.
 *
 * @pure — no side effects.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/** Parse a single row of CSV text starting at `pos`, return [fields, nextPos]. */
function parseRow(text: string, start: number): [string[], number] {
  const fields: string[] = [];
  let pos = start;
  const len = text.length;

  while (pos <= len) {
    // End of input or newline → row is complete
    if (pos === len || text[pos] === '\n' || (text[pos] === '\r' && text[pos + 1] === '\n')) {
      // Push empty field if row ended with a trailing comma
      if (fields.length === 0) fields.push('');
      const advance = pos < len && text[pos] === '\r' ? 2 : pos < len ? 1 : 0;
      return [fields, pos + advance];
    }

    // Quoted field
    if (text[pos] === '"') {
      let field = '';
      pos++; // skip opening quote
      while (pos < len) {
        if (text[pos] === '"') {
          if (text[pos + 1] === '"') {
            // Escaped quote
            field += '"';
            pos += 2;
          } else {
            // Closing quote
            pos++;
            break;
          }
        } else {
          field += text[pos++];
        }
      }
      fields.push(field);
      // Skip comma separator
      if (pos < len && text[pos] === ',') pos++;
    } else {
      // Unquoted field — read until comma or newline
      let field = '';
      while (pos < len && text[pos] !== ',' && text[pos] !== '\n' && text[pos] !== '\r') {
        field += text[pos++];
      }
      fields.push(field);
      if (pos < len && text[pos] === ',') pos++;
    }
  }

  return [fields, pos];
}

/** Parse CSV text into headers + body rows. */
export function parseCsv(text: string): ParsedCsv {
  const normalized = text.trim();
  if (!normalized) return { headers: [], rows: [] };

  let pos = 0;
  const allRows: string[][] = [];

  while (pos < normalized.length) {
    const [row, next] = parseRow(normalized, pos);
    allRows.push(row);
    pos = next;
  }

  const [headers = [], ...rows] = allRows;
  return { headers, rows };
}

/** Return true if every non-empty value in the column parses as a finite number. */
export function isNumericColumn(rows: string[][], colIndex: number): boolean {
  const values = rows.map((r) => r[colIndex] ?? '').filter(Boolean);
  if (values.length === 0) return false;
  return values.every((v) => isFinite(Number(v)));
}
