'use client';

/**
 * CsvViewer.tsx
 *
 * Renders a CSV file as a sortable, filterable table.
 * Features (per artboard spec):
 *   - Filter chip in the ViewerShell actions (header) slot.
 *   - Sticky header row (bg-mf-content2) with sort (asc → desc → off) per column.
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
import { Search } from 'lucide-react';
import { parseCsv, isNumericColumn, type CsvRow } from './csv-parser';
import { ViewerShell } from './ViewerShell';
import { splitCsvStatus } from './viewer-status';

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
  const filterChip = (
    <div className="inline-flex h-5 items-center gap-1 rounded-md bg-mf-chip px-2">
      <Search size={10} className="shrink-0 text-mf-text-3" aria-hidden />
      <input
        type="text"
        data-testid="viewer-csv-filter"
        placeholder="Filter rows"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-24 bg-transparent text-caption text-foreground placeholder:text-mf-text-3 focus:outline-none"
      />
    </div>
  );

  return (
    <ViewerShell path={path} status={statusLeft} statusRight={statusRight} actions={filterChip}>
      <div data-testid="viewer-csv" className="flex h-full flex-col">
        {/* Table */}
        {content === null ? (
          <div className="flex flex-1 items-center justify-center text-body text-muted-foreground">Loading…</div>
        ) : !parsed || parsed.headers.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-body text-muted-foreground">No data</div>
        ) : (
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse text-label">
              <thead className="sticky top-0 bg-mf-content2">
                <tr>
                  {/* Row-number gutter */}
                  <th className="w-10 [border-bottom:0.5px_solid_var(--border)] [border-right:0.5px_solid_var(--border)] px-3.5 py-1.5 text-right text-muted-foreground select-none">
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
                          'cursor-pointer [border-bottom:0.5px_solid_var(--border)] px-3.5 py-1.5 font-medium select-none',
                          'hover:bg-accent',
                          isNum ? 'text-right' : 'text-left',
                          isActive ? 'text-foreground' : 'text-muted-foreground',
                        ].join(' ')}
                      >
                        <span className="inline-flex items-center gap-1">
                          {header}
                          {isActive && sort.dir === 'asc' && (
                            <span className="text-primary" style={{ fontSize: 10 }}>
                              ▲
                            </span>
                          )}
                          {isActive && sort.dir === 'desc' && (
                            <span className="text-primary" style={{ fontSize: 10 }}>
                              ▼
                            </span>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, rowIdx) => (
                  <tr key={row._index} className={rowIdx % 2 === 0 ? 'bg-background' : 'bg-card'}>
                    <td className="[border-bottom:0.5px_solid_var(--border)] [border-right:0.5px_solid_var(--border)] px-3.5 py-1 text-right text-muted-foreground tabular-nums">
                      {rowIdx + 1}
                    </td>
                    {parsed.headers.map((_header, colIdx) => (
                      <td
                        key={colIdx}
                        className={[
                          'px-3.5 py-1 [border-bottom:0.5px_solid_var(--border)]',
                          numericCols.has(colIdx) ? 'text-right tabular-nums' : 'text-left',
                          'text-foreground',
                        ].join(' ')}
                      >
                        {row.cells[colIdx] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
                {displayRows.length === 0 && filter.trim() && (
                  <tr data-testid="viewer-csv-empty">
                    <td
                      colSpan={parsed.headers.length + 1}
                      className="px-3 py-10 text-center text-body text-muted-foreground"
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
