/**
 * MarkdownAnnotatedBlock — wraps an annotatable rendered markdown block (p,
 * h1-h6, li, pre, blockquote, table) with the hover-revealed add-note
 * control, or the persistent note marker when one already overlaps the
 * block's range. Reads the lifted note set from markdown-notes-context.
 *
 * Renders pure passthrough — no wrapper, no control — when: there is no
 * notes context (plain-render callers, e.g. bare MarkdownPreview.test.tsx),
 * the node carries no source position, or an annotated descendant shares
 * this node's exact range (the *Nested blocks* decision: only the
 * innermost same-range block gets a control).
 *
 * The hover reveal itself is CSS (app.css, `[data-md-block]`), not state —
 * jsdom cannot hover, and only the innermost hovered block among nested
 * `data-md-block`s should light up.
 */
import type { ReactNode } from 'react';
import type { ExtraProps } from 'react-markdown';
import { MessageSquarePlus, Sparkles } from 'lucide-react';
import { getBlockRange, hasAnnotatedDescendantWithSameRange } from './markdown-block-range';
import { useMarkdownNotesContext } from './markdown-notes-context';
import { InlineCommentWidget } from './inline-comments/InlineCommentWidget';

type HastElement = NonNullable<ExtraProps['node']>;

/** Written back to close the open widget — never a real note id (`comment-<uuid>`). */
const NO_OPEN_NOTE = '';

interface MarkdownAnnotatedBlockProps {
  node?: HastElement;
  children: ReactNode;
}

export function MarkdownAnnotatedBlock({ node, children }: MarkdownAnnotatedBlockProps) {
  const ctx = useMarkdownNotesContext();
  const range = ctx && node && !hasAnnotatedDescendantWithSameRange(node) ? getBlockRange(node, ctx.source) : null;

  if (!ctx || !range) return <>{children}</>;

  const { startLine, endLine, lineContent } = range;
  const overlapping = ctx.model.notes
    .filter((note) => note.startLine <= endLine && note.endLine >= startLine)
    .sort((a, b) => a.startLine - b.startLine);
  const hasNote = overlapping.length > 0;
  const rangeKey = `${startLine}-${endLine}`;

  function handleAdd() {
    if (!ctx) return;
    const id = ctx.model.addNote({ startLine, endLine, lineContent });
    ctx.openNote(id);
  }

  return (
    <div data-md-block className="relative">
      <span
        aria-hidden
        className="md-note-reveal pointer-events-none absolute inset-y-0 -inset-x-2 rounded-sm bg-primary/5 opacity-0 transition-opacity"
      />
      {!hasNote && (
        <button
          type="button"
          data-testid={`md-note-add-${rangeKey}`}
          aria-label="Add note"
          onClick={handleAdd}
          className="md-note-reveal absolute -right-8 top-0.5 flex size-5 items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-primary"
        >
          <MessageSquarePlus className="size-3.5" />
        </button>
      )}
      {hasNote && (
        <button
          type="button"
          data-testid={`md-note-marker-${rangeKey}`}
          aria-label="Open note"
          onClick={() => ctx.openNote(overlapping[0]!.id)}
          className="absolute -right-8 top-0.5 flex size-5 items-center justify-center text-primary"
        >
          <Sparkles className="size-3.5" />
        </button>
      )}
      {children}
      {overlapping.some((note) => note.id === ctx.openNoteId) &&
        overlapping.map((note) => (
          <div key={note.id} className="my-2">
            <InlineCommentWidget
              text={ctx.model.drafts[note.id] ?? note.text}
              lineNumber={note.startLine}
              endLine={note.endLine}
              lineContent={note.lineContent}
              onTextChange={(text) => ctx.model.setDraft(note.id, text)}
              onSave={() => {
                ctx.model.editNote(note.id, ctx.model.drafts[note.id] ?? note.text);
                ctx.openNote(NO_OPEN_NOTE);
              }}
              onClose={() => ctx.openNote(NO_OPEN_NOTE)}
              onDelete={() => ctx.model.deleteNote(note.id)}
              onSend={() => void ctx.handleSendOne(note.id)}
            />
          </div>
        ))}
    </div>
  );
}
