/**
 * csv-parser.ts
 *
 * Minimal RFC 4180-compliant CSV parser.
 * Handles: quoted fields (with embedded commas and newlines),
 * escaped double-quotes (two consecutive quotes inside a quoted field),
 * and CRLF + LF line endings.
 *
 * Returns `{ headers, headerRange, rows }`; every row and the header carry the
 * real source line range they occupy, numbered per CodeMirror's line-split rule.
 * Empty input returns empty headers, a null headerRange, and zero rows.
 *
 * @pure — no side effects.
 */
import { MAX_INLINE_LINES } from '@/features/editor/inline-comments/resolve-comment-range';

/** Same line-break rule CodeMirror's `Text.of` splits on — keeps CSV row numbers in Source lined up 1:1 with the raw text. */
const LINE_BREAK = /\r\n?|\n/;
const LINE_BREAK_GLOBAL = /\r\n?|\n/g;

export interface LineRange {
  startLine: number;
  endLine: number;
}

/** A parsed row with its original source-order index preserved. */
export interface CsvRow extends LineRange {
  /** The cell values for this row. */
  cells: string[];
  /** Stable index from the original parse order (survives sort/filter). */
  _index: number;
}

export interface ParsedCsv {
  headers: string[];
  /** Source line range of the header row, or `null` when there is no header (empty input). */
  headerRange: LineRange | null;
  rows: CsvRow[];
}

/** Parse a single row of CSV text starting at `pos`; `hadTerminator` is false only at EOF. */
function parseRow(text: string, start: number): [fields: string[], nextPos: number, hadTerminator: boolean] {
  const fields: string[] = [];
  let pos = start;
  const len = text.length;

  while (pos <= len) {
    // End of input or newline → row is complete.
    // Handles LF, CRLF, and bare CR (the latter is treated as LF per RFC 4180 §2).
    const isCR = text[pos] === '\r';
    const isRowEnd =
      pos === len || text[pos] === '\n' || (isCR && text[pos + 1] === '\n') || (isCR && text[pos + 1] !== '\n');
    if (isRowEnd) {
      // Push empty field for:
      //   (a) a fully-empty row (no fields at all), OR
      //   (b) a trailing comma — the last separator had no following value.
      // We detect (b) by checking whether the character immediately before
      // `pos` was a comma. `pos > start` guards against the empty-input edge.
      if (fields.length === 0) {
        fields.push('');
      } else if (pos > start && text[pos - 1] === ',') {
        fields.push('');
      }
      const advance =
        pos < len
          ? isCR && text[pos + 1] === '\n'
            ? 2 // CRLF
            : 1 // LF or bare CR
          : 0; // EOF
      return [fields, pos + advance, advance > 0];
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
      // Unquoted field — read until comma, LF, or CR (bare or CRLF start)
      let field = '';
      while (pos < len && text[pos] !== ',' && text[pos] !== '\n' && text[pos] !== '\r') {
        field += text[pos++];
      }
      fields.push(field);
      // Advance past comma separator; leave newlines for the row-end check above
      if (pos < len && text[pos] === ',') pos++;
    }
  }

  return [fields, pos, false];
}

/** A raw parsed row plus the source line range it occupies. */
interface RawRow extends LineRange {
  cells: string[];
}

/** True for a row the leading/trailing-blank-row rule should drop (a single empty cell). */
function isBlankRow(cells: string[]): boolean {
  return cells.length === 1 && cells[0] === '';
}

/** Parse CSV text into headers + body rows, keyed to their real source lines. */
export function parseCsv(text: string): ParsedCsv {
  let pos = 0;
  let line = 1;
  const allRows: RawRow[] = [];

  while (pos < text.length) {
    const [cells, next, hadTerminator] = parseRow(text, pos);
    const totalBreaks = text.slice(pos, next).match(LINE_BREAK_GLOBAL)?.length ?? 0;
    // Exclude the row's own terminating break (if any) — the rest are embedded newlines in a quoted field.
    const embeddedBreaks = totalBreaks - (hadTerminator ? 1 : 0);
    const startLine = line;
    const endLine = startLine + embeddedBreaks;
    allRows.push({ cells, startLine, endLine });
    line = startLine + totalBreaks;
    // Safety: if the parser returns the same position, advance by one to
    // prevent an infinite loop on malformed input.
    pos = next > pos ? next : pos + 1;
  }

  // Leading/trailing all-empty rows don't count as data (or as the header);
  // their lines already advanced `line` above, so numbering stays correct.
  let start = 0;
  let end = allRows.length;
  while (start < end && isBlankRow(allRows[start]!.cells)) start++;
  while (end > start && isBlankRow(allRows[end - 1]!.cells)) end--;
  const surviving = allRows.slice(start, end);

  const [header, ...rawRows] = surviving;
  const headers = header?.cells ?? [];
  const headerRange: LineRange | null = header ? { startLine: header.startLine, endLine: header.endLine } : null;
  const rows: CsvRow[] = rawRows.map((row, index) => ({ ...row, _index: index }));
  return { headers, headerRange, rows };
}

/** Raw source lines for a row's range, capped like `resolveCommentRange` so quotes never blow past `MAX_INLINE_LINES`. */
export function sliceCsvRowSource(text: string, range: LineRange): string {
  if (range.endLine - range.startLine + 1 > MAX_INLINE_LINES) return '';
  const lines = text.split(LINE_BREAK);
  return lines.slice(range.startLine - 1, range.endLine).join('\n');
}

/** Return true if every non-empty value in the column parses as a finite number. */
export function isNumericColumn(rows: CsvRow[], colIndex: number): boolean {
  const values = rows.map((r) => r.cells[colIndex] ?? '').filter(Boolean);
  if (values.length === 0) return false;
  return values.every((v) => isFinite(Number(v)));
}
