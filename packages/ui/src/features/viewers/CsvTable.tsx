'use client';

/**
 * CsvTable.tsx
 *
 * The sortable, filterable `<table>` body of CsvViewer, extracted so
 * CsvViewer stays under the file-size limit once it also owns a mode toggle.
 *
 * Row-granular agent notes: hovering a body row reveals an add-note control
 * in a trailing action column; an annotated row shows a persistent marker
 * instead. Activating either opens the shared InlineCommentWidget as a
 * full-width sibling row directly beneath the annotated one. The row-number
 * gutter shows the row's real source line (`row.startLine`), which is what
 * the note records — never the row's position in the sorted/filtered view.
 */
import { Fragment, useState } from 'react';
import { ChevronsUpDown, MessageSquarePlus, Sparkles } from 'lucide-react';
import { InlineCommentWidget } from '@/features/editor/inline-comments/InlineCommentWidget';
import type { UseFileNotesResult } from '@/features/editor/inline-comments/use-file-notes';
import { sliceCsvRowSource, type CsvRow } from './csv-parser';

export type SortDir = 'asc' | 'desc' | null;

export interface SortState {
  colIndex: number;
  dir: SortDir;
}

interface CsvTableProps {
  headers: string[];
  rows: CsvRow[];
  numericCols: Set<number>;
  sort: SortState;
  onHeaderClick: (colIndex: number) => void;
  filter: string;
  rawText: string;
  model: UseFileNotesResult;
  onSendOne: (id: string) => void;
  onDeleteNote: (id: string) => void;
}

/** The trailing action cell: hover add-control, or a persistent marker when the row already has a note. */
function RowNoteAction({
  row,
  model,
  rawText,
  onOpen,
}: {
  row: CsvRow;
  model: UseFileNotesResult;
  rawText: string;
  onOpen: (id: string) => void;
}) {
  const existing = model.getNotesForLine(row.startLine)[0];

  if (existing) {
    return (
      <button
        type="button"
        data-testid={`csv-note-marker-${row.startLine}`}
        aria-label="Open agent note"
        className="flex size-4 items-center justify-center text-primary"
        onClick={() => onOpen(existing.id)}
      >
        <Sparkles className="size-3" aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid={`csv-note-add-${row.startLine}`}
      aria-label="Add agent note"
      className="flex size-4 items-center justify-center text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary"
      onClick={() => {
        const id = model.addNote({
          startLine: row.startLine,
          endLine: row.endLine,
          lineContent: sliceCsvRowSource(rawText, row),
        });
        onOpen(id);
      }}
    >
      <MessageSquarePlus className="size-3" aria-hidden />
    </button>
  );
}

export function CsvTable({
  headers,
  rows,
  numericCols,
  sort,
  onHeaderClick,
  filter,
  rawText,
  model,
  onSendOne,
  onDeleteNote,
}: CsvTableProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openNote = openId ? model.notes.find((n) => n.id === openId) : undefined;
  const colCount = headers.length + 2;

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-card">
          <tr>
            <th className="w-10 border-r border-b border-border px-3.5 py-1.5 text-right font-mono text-xs text-muted-foreground/50 select-none">
              #
            </th>
            {headers.map((header, i) => {
              const isActive = sort.colIndex === i;
              const isNum = numericCols.has(i);
              return (
                <th
                  key={i}
                  data-testid={`viewer-csv-header-${header}`}
                  onClick={() => onHeaderClick(i)}
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
                    {isActive && <ChevronsUpDown className="size-2.5 shrink-0 text-muted-foreground" aria-hidden />}
                  </span>
                </th>
              );
            })}
            <th className="w-8 border-b border-border" aria-label="Notes" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <Fragment key={row._index}>
              <tr
                className={['group', rowIdx % 2 === 0 ? 'bg-background' : 'bg-muted/40', 'hover:bg-primary/5'].join(
                  ' ',
                )}
              >
                <td className="border-r border-b border-border px-3.5 py-1.5 text-right font-mono text-xs text-muted-foreground/50 tabular-nums">
                  {row.startLine}
                </td>
                {headers.map((_header, colIdx) => (
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
                <td className="border-b border-border px-1.5 py-1.5 text-center">
                  <RowNoteAction row={row} model={model} rawText={rawText} onOpen={setOpenId} />
                </td>
              </tr>
              {openNote && openNote.startLine === row.startLine && (
                <tr>
                  <td colSpan={colCount} className="border-b border-border bg-card p-0">
                    <InlineCommentWidget
                      text={model.drafts[openNote.id] ?? openNote.text}
                      lineNumber={openNote.startLine}
                      endLine={openNote.endLine}
                      lineContent={openNote.lineContent}
                      onTextChange={(t) => model.setDraft(openNote.id, t)}
                      onSave={() => {
                        model.editNote(openNote.id, model.drafts[openNote.id] ?? openNote.text);
                        setOpenId(null);
                      }}
                      onClose={() => setOpenId(null)}
                      onDelete={() => {
                        onDeleteNote(openNote.id);
                        setOpenId(null);
                      }}
                      onSend={() => {
                        onSendOne(openNote.id);
                        setOpenId(null);
                      }}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {rows.length === 0 && filter.trim() && (
            <tr data-testid="viewer-csv-empty">
              <td colSpan={colCount} className="px-3 py-10 text-center text-xs text-muted-foreground">
                {`No rows match "${filter}".`}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
