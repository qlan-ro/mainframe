'use client';

/**
 * CsvViewer.tsx
 *
 * Renders a CSV file as a sortable, filterable table.
 * Features (per artboard spec):
 *   - Sticky header row with sort (asc → desc → off) per column.
 *   - Row-number gutter column.
 *   - Right-aligned numeric columns (auto-detected).
 *   - Live filter input that narrows rows.
 *   - Zebra striping via odd/even row classes.
 *
 * No external CSV dep — uses the hand-rolled `csv-parser.ts`.
 * data-testid="viewer-csv" on the root.
 */
import { useMemo, useState } from 'react';
import { parseCsv, isNumericColumn, type CsvRow } from './csv-parser';

interface CsvViewerProps {
  content: string | null;
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

export function CsvViewer({ content }: CsvViewerProps) {
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortState>({ colIndex: -1, dir: null });

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

  return (
    <div data-testid="viewer-csv" className="flex h-full flex-col">
      {/* Filter bar */}
      <div className="flex shrink-0 items-center gap-2 [border-bottom:0.5px_solid_var(--border)] px-3 py-1.5">
        <input
          type="text"
          data-testid="viewer-csv-filter"
          placeholder="Filter rows…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-6 flex-1 rounded border border-border bg-card px-2 text-label text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {parsed && (
          <span className="text-label text-muted-foreground">
            {displayRows.length} / {parsed.rows.length} rows
          </span>
        )}
      </div>

      {/* Table */}
      {content === null ? (
        <div className="flex flex-1 items-center justify-center text-body text-muted-foreground">Loading…</div>
      ) : !parsed || parsed.headers.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-body text-muted-foreground">No data</div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-label">
            <thead className="sticky top-0 bg-background">
              <tr>
                {/* Row-number gutter */}
                <th className="w-10 [border-bottom:0.5px_solid_var(--border)] [border-right:0.5px_solid_var(--border)] px-2 py-1.5 text-right text-muted-foreground select-none">
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
                        'cursor-pointer [border-bottom:0.5px_solid_var(--border)] px-2 py-1.5 font-medium select-none',
                        'hover:bg-accent',
                        isNum ? 'text-right' : 'text-left',
                        isActive ? 'text-foreground' : 'text-muted-foreground',
                      ].join(' ')}
                    >
                      {header}
                      {isActive && sort.dir === 'asc' && ' ↑'}
                      {isActive && sort.dir === 'desc' && ' ↓'}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, rowIdx) => (
                <tr key={row._index} className={rowIdx % 2 === 0 ? 'bg-background' : 'bg-card'}>
                  <td className="[border-right:0.5px_solid_var(--border)] px-2 py-1 text-right text-muted-foreground tabular-nums">
                    {rowIdx + 1}
                  </td>
                  {parsed.headers.map((_header, colIdx) => (
                    <td
                      key={colIdx}
                      className={[
                        'px-2 py-1',
                        numericCols.has(colIdx) ? 'text-right tabular-nums' : 'text-left',
                        'text-foreground',
                      ].join(' ')}
                    >
                      {row.cells[colIdx] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
