'use client';

/**
 * A tile with a note (C14): "Add a note" until there is one, then a pencil
 * that shows on hover or focus. The editor writes as you type, so closing it
 * any way keeps the note. It belongs to the tile, not to the control that
 * opened it: the first character turns one control into the other.
 */
import { useRef, useState, type ReactNode } from 'react';
import { PencilIcon } from '@/components/ui/glyphs';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { DraftTile, RemoveTileButton } from './DraftTile';

interface NoteTileProps {
  testId: string;
  lead: ReactNode;
  /** What the note is on, for the controls' names: "element1", "codex.rs:32–38". */
  subject: string;
  detail: string;
  /** What the tooltip says after the note. */
  where: string;
  note: string;
  setNote: (note: string) => void;
  remove: () => void;
}

export function NoteTile({ testId, lead, subject, detail, where, note, setNote, remove }: NoteTileProps) {
  const [editing, setEditing] = useState(false);
  const control = useRef<HTMLButtonElement>(null);
  const pressedOutside = useRef(false);
  // A blank note is no note; what was typed so far is still the editor's value.
  const shown = note.replace(/\s+/g, ' ').trim();
  const open = () => {
    pressedOutside.current = false;
    setEditing(true);
  };

  return (
    <Popover open={editing} onOpenChange={setEditing}>
      <DraftTile
        testId={testId}
        lead={lead}
        title={
          shown || (
            <button
              ref={control}
              type="button"
              data-testid="composer-note-add"
              aria-label={`Add a note on ${subject}`}
              onClick={open}
              className="relative w-fit rounded-sm text-left text-small/tight font-normal text-accent-ink before:absolute before:-inset-x-1 before:top-1/2 before:h-6 before:-translate-y-1/2 hover:underline focus-visible:focus-line"
            >
              Add a note
            </button>
          )
        }
        detail={detail}
        monoDetail
        full={[note.trim(), where].filter(Boolean).join(' · ')}
        actions={
          shown ? (
            // Lies over the end of the text until it is wanted, so it takes no room from it.
            <Button
              ref={control}
              type="button"
              variant="ghost"
              size="icon-xs"
              data-testid="composer-note-edit"
              aria-label={`Edit the note on ${subject}`}
              onClick={open}
              className="absolute top-2 right-7 z-20 size-6 rounded-sm bg-queue-well text-muted-foreground opacity-0 shadow-[-10px_0_8px_-2px_var(--queue-well)] group-focus-within/tile:opacity-100 group-hover/tile:opacity-100"
            >
              <PencilIcon className="size-4" />
            </Button>
          ) : null
        }
        remove={
          <RemoveTileButton data-testid="composer-draft-item-remove" label={`Remove ${subject}`} onClick={remove} />
        }
      >
        <PopoverAnchor asChild>
          <span aria-hidden className="pointer-events-none absolute inset-0" />
        </PopoverAnchor>
      </DraftTile>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={6}
        className="w-64 p-2"
        onInteractOutside={() => {
          pressedOutside.current = true;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // A press elsewhere has already put focus where it belongs.
          if (!pressedOutside.current) control.current?.focus();
        }}
      >
        <Textarea
          data-testid="composer-note-input"
          aria-label={`Note on ${subject}`}
          placeholder="Add a note…"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            setEditing(false);
          }}
          className="min-h-16 resize-none text-sm"
        />
      </PopoverContent>
    </Popover>
  );
}
