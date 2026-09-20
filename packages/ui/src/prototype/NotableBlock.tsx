/* PROTOTYPE — #357 add-note affordance on a rendered markdown block, three
 * variants, plus the shared submit bar. Reuses the real InlineCommentWidget. */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { MessageSquarePlus, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mfToast } from '@/lib/toast';
import { InlineCommentWidget } from '@/features/editor/inline-comments/InlineCommentWidget';
import { notes, useNotes } from './notes-store';

export const NotesSourceContext = createContext<string>('');

interface Position {
  start: { line: number };
  end: { line: number };
}

interface NotableBlockProps {
  variant: string;
  node?: { position?: Position };
  children: ReactNode;
}

export function NotableBlock({ variant, node, children }: NotableBlockProps) {
  const source = useContext(NotesSourceContext);
  const { notes: all, openId } = useNotes();
  const [selected, setSelected] = useState(false);
  const pos = node?.position;
  if (!pos) return <>{children}</>;
  const start = pos.start.line;
  const end = pos.end.line;
  const note = all.find((n) => n.startLine === start && n.endLine === end);
  const isOpen = note !== undefined && openId === note.id;
  const content = source.split('\n').slice(start - 1, end).join('\n');
  const add = () => {
    notes.openDraft(start, end, content);
    setSelected(false);
  };

  const marker = note && !isOpen && (
    <button
      type="button"
      onClick={add}
      className={cn('absolute top-0.5 flex size-5 items-center justify-center text-primary', variant === 'B' ? '-right-8' : '-left-8')}
      aria-label="Open note"
    >
      <Sparkles className="size-3.5" />
    </button>
  );

  const affordance =
    variant === 'A' ? (
      <>
        <span className="pointer-events-none absolute -left-3 inset-y-0 w-0.5 rounded-full bg-primary/40 opacity-0 transition-opacity group-hover/blk:opacity-100" />
        {!note && (
          <button
            type="button"
            onClick={add}
            data-testid={`md-note-add-${start}`}
            className="absolute -left-8 top-0.5 flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-primary group-hover/blk:opacity-100"
            aria-label="Add note"
          >
            <MessageSquarePlus className="size-3" />
          </button>
        )}
      </>
    ) : variant === 'B' ? (
      <>
        <span className="pointer-events-none absolute -inset-x-2 inset-y-0 rounded-sm bg-primary/5 opacity-0 transition-opacity group-hover/blk:opacity-100" />
        {!note && (
          <button
            type="button"
            onClick={add}
            data-testid={`md-note-add-${start}`}
            className="absolute -right-8 top-0.5 flex size-5 items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover/blk:opacity-100"
            aria-label="Add note"
          >
            <MessageSquarePlus className="size-3.5" />
          </button>
        )}
      </>
    ) : (
      selected &&
      !note && (
        <div className="absolute -top-7 left-0 z-10 flex items-center gap-1 rounded-md bg-popover px-1 py-0.5 text-xs shadow-md ring-1 ring-foreground/10">
          <button type="button" onClick={add} data-testid={`md-note-add-${start}`} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent">
            <MessageSquarePlus className="size-3" /> Add note
          </button>
          <span className="text-muted-foreground">L{start}{end !== start ? `–${end}` : ''}</span>
        </div>
      )
    );

  return (
    <div
      className={cn('group/blk relative', variant === 'C' && 'cursor-default rounded-sm', variant === 'C' && selected && 'ring-1 ring-primary/40 ring-offset-2 ring-offset-background')}
      onClick={variant === 'C' ? () => setSelected((s) => !s) : undefined}
    >
      {affordance}
      {marker}
      {children}
      {isOpen && note && (
        <div className="my-2" onClick={(e) => e.stopPropagation()}>
          <InlineCommentWidget
            text={note.text}
            lineNumber={start}
            endLine={end}
            lineContent={content}
            onTextChange={(t) => notes.setText(note.id, t)}
            onSave={() => notes.close(note.id)}
            onClose={() => notes.close(note.id)}
            onDelete={() => notes.remove(note.id)}
            onSend={() => {
              mfToast({ type: 'info', title: `send one note → L${start}` });
              notes.remove(note.id);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** One bar per file tab, shown in every mode. Mirrors the editor's SubmitReviewBar. */
export function NotesSubmitBar() {
  const { notes: all } = useNotes();
  const filled = all.filter((n) => n.text.trim() !== '').length;
  if (all.length === 0) return null;
  return (
    <div
      data-testid="md-notes-submit-bar"
      className="sticky bottom-0 z-10 flex items-center justify-between border-t border-border bg-card px-3 py-1.5 text-xs"
    >
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" />
        {filled} of {all.length} agent notes filled
      </span>
      <button
        type="button"
        onClick={() => {
          mfToast({ type: 'info', title: `submit review → ${filled} notes, source-line order` });
          notes.clear();
        }}
        className="rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground hover:bg-primary/90"
      >
        Submit review ({all.length})
      </button>
    </div>
  );
}
