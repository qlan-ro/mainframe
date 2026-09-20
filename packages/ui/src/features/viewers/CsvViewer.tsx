'use client';

/**
 * CsvViewer.tsx
 *
 * Renders a CSV file as a sortable, filterable table.
 * Features (per artboard spec):
 *   - Filter chip in the ViewerShell actions (header) slot.
 *   - Sticky header row (bg-card) with sort (asc → desc → off) per column.
 *   - Accent-colored ▲/▼ sort arrows (text-primary span).
 *   - Row-number gutter column.
 *   - Right-aligned numeric columns (auto-detected).
 *   - Live filter input that narrows rows.
 *   - Zebra striping via odd/even row classes.
 *   - statusRight slot wired with row/col counts.
 *
 * No external CSV dep — uses the hand-rolled `csv-parser.ts`.
 * data-testid="viewer-csv" on the root.
 */
import { useMemo, useState } from 'react';
import { Search, ChevronsUpDown } from 'lucide-react';
import { parseCsv, isNumericColumn, type CsvRow } from './csv-parser';
import { ViewerShell } from './ViewerShell';
import { splitCsvStatus } from './viewer-status';
// PROTOTYPE (#357) — remove with packages/ui/src/prototype/
import { usePrototype } from '@/prototype/variant';
import { CsvModeToggle, CsvNoteRow, CsvRowGutter, CsvRowTrailingAction, CsvSelectToolbar, CsvSourceListing, type CsvMode } from '@/prototype/csv-notes';

interface CsvViewerProps {
  content: string | null;
  path: string;
}

type SortDir = 'asc' | 'desc' | null;

interface SortState {
  colIndex: number;
  dir: SortDir;
}

function nextSortDir(current: SortDir): SortDir {
  if (current === null) return 'asc';
  if (current === 'asc') return 'desc';
  return null;
}

export function CsvViewer({ content, path }: CsvViewerProps) {
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortState>({ colIndex: -1, dir: null });
  const proto = usePrototype('notes');
  const [mode, setMode] = useState<CsvMode>('preview');
  const [selectedLine, setSelectedLine] = useState<number | null>(null);

  const parsed = useMemo(() => (content !== null ? parseCsv(content) : null), [content]);

  const numericCols = useMemo(() => {
    if (!parsed) return new Set<number>();
    return new Set(parsed.headers.map((_, i) => i).filter((i) => isNumericColumn(parsed.rows, i)));
  }, [parsed]);

  const displayRows = useMemo((): CsvRow[] => {
    if (!parsed) return [];
    let rows = parsed.rows;

    if (filter.trim()) {
      const term = filter.toLowerCase();
      rows = rows.filter((row) => row.cells.some((cell) => cell.toLowerCase().includes(term)));
    }

    if (sort.colIndex >= 0 && sort.dir !== null) {
      const { colIndex, dir } = sort;
      const isNum = numericCols.has(colIndex);
      rows = [...rows].sort((a, b) => {
        const av = a.cells[colIndex] ?? '';
        const bv = b.cells[colIndex] ?? '';
        const cmp = isNum ? Number(av) - Number(bv) : av.localeCompare(bv);
        return dir === 'asc' ? cmp : -cmp;
      });
    }

    return rows;
  }, [parsed, filter, sort, numericCols]);

  function handleHeaderClick(colIndex: number) {
    setSort((prev) => {
      if (prev.colIndex === colIndex) {
        return { colIndex, dir: nextSortDir(prev.dir) };
      }
      return { colIndex, dir: 'asc' };
    });
  }

  const totalRows = parsed?.rows.length ?? 0;
  const cols = parsed?.headers.length ?? 0;

  const { left: statusLeft, right: statusRight } = splitCsvStatus({
    rows: totalRows,
    cols,
    filtered: filter.trim() ? displayRows.length : undefined,
    total: filter.trim() ? totalRows : undefined,
  });

  // Filter chip — lives in the ViewerShell header actions slot.
  // A v2 InputGroup is the primitive for this, but its 36px frame does not fit
  // the 28px viewer header — the compact chip stays, on v2 tokens.
  const filterChip = (
    <div className="inline-flex h-5 items-center gap-1 rounded-sm bg-muted px-2">
      <Search className="size-2.5 shrink-0 text-muted-foreground" aria-hidden />
      <input
        type="text"
        data-testid="viewer-csv-filter"
        placeholder="Filter rows"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-24 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
    </div>
  );

  return (
    <ViewerShell
      path={path}
      status={statusLeft}
      statusRight={statusRight}
      actions={proto ? <div className="flex items-center gap-2">{filterChip}<CsvModeToggle mode={mode} onChange={setMode} /></div> : filterChip}
    >
      <div data-testid="viewer-csv" className="flex h-full flex-col">
        {/* Table */}
        {proto && mode === 'source' ? (
          <CsvSourceListing content={content ?? ''} variant={proto} />
        ) : content === null ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : !parsed || parsed.headers.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">No data</div>
        ) : (
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-card">
                <tr>
                  {/* Row-number gutter */}
                  {/* PROTOTYPE: variant B adds a trailing action column */}
                  <th className="w-10 border-r border-b border-border px-3.5 py-1.5 text-right font-mono text-xs text-muted-foreground/50 select-none">
                    #
                  </th>
                  {parsed.headers.map((header, i) => {
                    const isActive = sort.colIndex === i;
                    const isNum = numericCols.has(i);
                    return (
                      <th
                        key={i}
                        data-testid={`viewer-csv-header-${header}`}
                        onClick={() => handleHeaderClick(i)}
                        className={[
                          'cursor-pointer border-b border-border px-3.5 py-1.5 font-semibold select-none',
                          'hover:bg-muted',
                          isNum ? 'text-right' : 'text-left',
                          isActive ? 'text-foreground' : 'text-muted-foreground',
                        ].join(' ')}
                      >
                        <span className={['inline-flex items-center gap-1', isNum ? 'flex-row-reverse' : ''].join(' ')}>
                          {header}
                          {isActive && sort.dir === 'asc' && <span className="text-xs text-primary">▲</span>}
                          {isActive && sort.dir === 'desc' && <span className="text-xs text-primary">▼</span>}
                          {isActive && (
                            <ChevronsUpDown className="size-2.5 shrink-0 text-muted-foreground" aria-hidden />
                          )}
                        </span>
                      </th>
                    );
                  })}
                  {proto === 'B' && <th className="w-8 border-b border-border" />}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, rowIdx) => {
                  // PROTOTYPE: source line ≈ ordinal + 2 (header on line 1).
                  const line = row._index + 2;
                  const raw = row.cells.join(',');
                  return (
                  <>
                  <tr
                    key={row._index}
                    onClick={proto === 'C' ? () => setSelectedLine((s) => (s === line ? null : line)) : undefined}
                    className={[
                      'group/row relative',
                      rowIdx % 2 === 0 ? 'bg-background' : 'bg-muted/40',
                      proto === 'C' && selectedLine === line ? 'bg-primary/5' : '',
                    ].join(' ')}
                  >
                    <td className="border-r border-b border-border px-3.5 py-1.5 text-right font-mono text-xs text-muted-foreground/50 tabular-nums">
                      {proto ? (
                        <CsvRowGutter variant={proto} line={line} content={raw}>
                          {line}
                        </CsvRowGutter>
                      ) : (
                        rowIdx + 1
                      )}
                      {proto === 'C' && selectedLine === line && (
                        <CsvSelectToolbar line={line} content={raw} onDone={() => setSelectedLine(null)} />
                      )}
                    </td>
                    {parsed.headers.map((_header, colIdx) => (
                      <td
                        key={colIdx}
                        className={[
                          'border-b border-border px-3.5 py-1.5',
                          numericCols.has(colIdx) ? 'text-right font-mono text-xs tabular-nums' : 'text-left',
                          'text-foreground',
                        ].join(' ')}
                      >
                        {row.cells[colIdx] ?? ''}
                      </td>
                    ))}
                    {proto === 'B' && (
                      <td className="w-8 border-b border-border px-2 py-1.5">
                        <CsvRowTrailingAction line={line} content={raw} />
                      </td>
                    )}
                  </tr>
                  {proto && <CsvNoteRow line={line} colSpan={parsed.headers.length + 2} />}
                  </>
                  );
                })}
                {displayRows.length === 0 && filter.trim() && (
                  <tr data-testid="viewer-csv-empty">
                    <td
                      colSpan={parsed.headers.length + 1}
                      className="px-3 py-10 text-center text-xs text-muted-foreground"
                    >
                      {`No rows match "${filter}".`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ViewerShell>
  );
}
