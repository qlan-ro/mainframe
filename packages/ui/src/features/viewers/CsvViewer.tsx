'use client';

/**
 * CsvViewer.tsx
 *
 * Renders a CSV file as a sortable, filterable table (Preview) or the raw
 * text in the comment-gutter editor (Source). Both modes are read-only; the
 * file tab owns one agent-notes set (`useFileTabNotes`) that survives the
 * toggle, with one NotesSubmitBar shown in both modes.
 *
 * Table rendering (header, sort, rows, empty-filter row) lives in CsvTable;
 * Source lives in CsvSource — both extracted to keep this file under the
 * 300-line limit once it also owns the mode toggle and the note wiring.
 *
 * No external CSV dep — uses the hand-rolled `csv-parser.ts`.
 * data-testid="viewer-csv" on the root.
 */
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { parseCsv, isNumericColumn, type CsvRow } from './csv-parser';
import { CsvTable, type SortState } from './CsvTable';
import { CsvSource } from './CsvSource';
import { ViewerShell } from './ViewerShell';
import { Segmented } from './Segmented';
import { splitCsvStatus } from './viewer-status';
import { useFileTabNotes } from '@/features/editor/inline-comments/use-file-notes';

interface CsvViewerProps {
  content: string | null;
  path: string;
}

type CsvMode = 'preview' | 'source';

function nextSortDir(current: SortState['dir']): SortState['dir'] {
  if (current === null) return 'asc';
  if (current === 'asc') return 'desc';
  return null;
}

export function CsvViewer({ content, path }: CsvViewerProps) {
  const [mode, setMode] = useState<CsvMode>('preview');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortState>({ colIndex: -1, dir: null });

  const { model, submitBar, handleSendOne, removeComment } = useFileTabNotes({ filePath: path });

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

  // Filter chip — lives in the ViewerShell header actions slot, hidden in
  // Source where there is nothing to filter.
  const filterChip = mode === 'preview' && (
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

  const toggle = (
    <Segmented
      value={mode}
      onChange={(id) => setMode(id as CsvMode)}
      options={[
        { id: 'preview', label: 'Preview', testId: 'viewer-csv-preview-toggle' },
        { id: 'source', label: 'Source', testId: 'viewer-csv-source-toggle' },
      ]}
    />
  );

  return (
    <ViewerShell
      path={path}
      status={statusLeft}
      statusRight={statusRight}
      actions={
        <>
          {filterChip}
          {toggle}
        </>
      }
    >
      <div data-testid="viewer-csv" className="flex h-full flex-col">
        {submitBar}
        {content === null ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : mode === 'source' ? (
          <CsvSource content={content} path={path} model={model} />
        ) : !parsed || parsed.headers.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">No data</div>
        ) : (
          <CsvTable
            headers={parsed.headers}
            rows={displayRows}
            numericCols={numericCols}
            sort={sort}
            onHeaderClick={handleHeaderClick}
            filter={filter}
            rawText={content}
            model={model}
            onSendOne={handleSendOne}
            onDeleteNote={removeComment}
          />
        )}
      </div>
    </ViewerShell>
  );
}
