/* PROTOTYPE — #357 CSV row-level note affordance (three variants) and a
 * Preview/Source toggle whose Source pane is a numbered read-only listing with
 * the same per-line gesture. Row → source line is approximated as index+2
 * (header on line 1, no multi-line fields); the real change exposes a per-row
 * line range from the parser. */
import { useState, type ReactNode } from 'react';
import { MessageSquarePlus, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mfToast } from '@/lib/toast';
import { InlineCommentWidget } from '@/features/editor/inline-comments/InlineCommentWidget';
import { Segmented } from '@/features/viewers/Segmented';
import { notes, useNotes } from './notes-store';

export type CsvMode = 'preview' | 'source';

export function CsvModeToggle({ mode, onChange }: { mode: CsvMode; onChange: (m: CsvMode) => void }) {
  return (
    <Segmented
      value={mode}
      onChange={(id) => onChange(id as CsvMode)}
      options={[
        { id: 'preview', label: 'Preview', testId: 'csv-mode-preview' },
        { id: 'source', label: 'Source', testId: 'csv-mode-source' },
      ]}
    />
  );
}

interface RowGutterProps {
  variant: string;
  line: number;
  content: string;
  /** What the gutter shows when idle (the source line number). */
  children: ReactNode;
}

/** Row-number gutter cell that doubles as the add-note affordance. */
export function CsvRowGutter({ variant, line, content, children }: RowGutterProps) {
  const { notes: all } = useNotes();
  const has = all.some((n) => n.startLine === line);
  const add = (e: React.MouseEvent) => {
    e.stopPropagation();
    notes.openDraft(line, line, content);
  };
  if (has) {
    return (
      <button type="button" onClick={add} className="flex w-full items-center justify-end text-primary" aria-label="Open note">
        <Sparkles className="size-3" />
      </button>
    );
  }
  if (variant === 'A') {
    return (
      <button type="button" onClick={add} data-testid={`csv-note-add-${line}`} className="group/g flex w-full items-center justify-end" aria-label="Add note">
        <span className="group-hover/g:hidden">{children}</span>
        <MessageSquarePlus className="hidden size-3 text-primary group-hover/g:block" />
      </button>
    );
  }
  return <>{children}</>;
}

/** Variant B's trailing cell: an icon that appears on row hover. */
export function CsvRowTrailingAction({ line, content }: { line: number; content: string }) {
  const { notes: all } = useNotes();
  if (all.some((n) => n.startLine === line)) return null;
  return (
    <button
      type="button"
      data-testid={`csv-note-add-${line}`}
      onClick={(e) => {
        e.stopPropagation();
        notes.openDraft(line, line, content);
      }}
      className="text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover/row:opacity-100"
      aria-label="Add note"
    >
      <MessageSquarePlus className="size-3.5" />
    </button>
  );
}

/** Variant C: row click selects; toolbar sits over the selected row. */
export function CsvSelectToolbar({ line, content, onDone }: { line: number; content: string; onDone: () => void }) {
  return (
    <div className="absolute left-12 -top-7 z-10 flex items-center gap-1 rounded-md bg-popover px-1 py-0.5 text-xs shadow-md ring-1 ring-foreground/10">
      <button
        type="button"
        data-testid={`csv-note-add-${line}`}
        onClick={() => {
          notes.openDraft(line, line, content);
          onDone();
        }}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent"
      >
        <MessageSquarePlus className="size-3" /> Add note
      </button>
      <span className="text-muted-foreground">L{line}</span>
    </div>
  );
}

/** The open widget for a row, rendered as a full-width row beneath it. */
export function CsvNoteRow({ line, colSpan }: { line: number; colSpan: number }) {
  const { notes: all, openId } = useNotes();
  const note = all.find((n) => n.startLine === line);
  if (!note || openId !== note.id) return null;
  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-border bg-background px-3 py-2">
        <InlineCommentWidget
          text={note.text}
          lineNumber={line}
          lineContent={note.content}
          onTextChange={(t) => notes.setText(note.id, t)}
          onSave={() => notes.close(note.id)}
          onClose={() => notes.close(note.id)}
          onDelete={() => notes.remove(note.id)}
          onSend={() => {
            mfToast({ type: 'info', title: `send one note → L${line}` });
            notes.remove(note.id);
          }}
        />
      </td>
    </tr>
  );
}

/** Source mode: numbered read-only lines with the gutter gesture (stand-in for the gutter editor). */
export function CsvSourceListing({ content, variant }: { content: string; variant: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const { notes: all, openId } = useNotes();
  const lines = content.split('\n');
  return (
    <div className="h-full overflow-auto font-mono text-xs">
      {lines.map((text, i) => {
        const line = i + 1;
        const note = all.find((n) => n.startLine === line);
        const open = note && openId === note.id;
        return (
          <div key={line} className="relative">
            <div
              className={cn('group/row flex items-start hover:bg-muted/60', variant === 'C' && selected === line && 'bg-primary/5')}
              onClick={variant === 'C' ? () => setSelected((s) => (s === line ? null : line)) : undefined}
            >
              <div className="w-12 shrink-0 select-none border-r border-border px-2 py-0.5 text-right text-muted-foreground/50">
                <CsvRowGutter variant={variant} line={line} content={text}>
                  {line}
                </CsvRowGutter>
              </div>
              <pre className="flex-1 whitespace-pre px-3 py-0.5 text-foreground">{text}</pre>
              {variant === 'B' && (
                <div className="px-2 py-0.5">
                  <CsvRowTrailingAction line={line} content={text} />
                </div>
              )}
            </div>
            {variant === 'C' && selected === line && !note && (
              <CsvSelectToolbar line={line} content={text} onDone={() => setSelected(null)} />
            )}
            {open && note && (
              <div className="border-b border-border px-3 py-2">
                <InlineCommentWidget
                  text={note.text}
                  lineNumber={line}
                  lineContent={text}
                  onTextChange={(t) => notes.setText(note.id, t)}
                  onSave={() => notes.close(note.id)}
                  onClose={() => notes.close(note.id)}
                  onDelete={() => notes.remove(note.id)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
