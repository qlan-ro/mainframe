'use client';

/**
 * Composer shell — the warm-chrome restyle of the native `ComposerPrimitive`.
 *
 * Native ~90%: Root/Input own the draft + submit; Send↔Cancel swaps on
 * `thread.isRunning`. The bottom toolbar's left slot is where the config
 * controls (model · effort · features · plan · permission) mount in the next
 * increment; the daemon-backed queued banner + attachments rows land there too.
 *
 * (Decomposed out of ChatThread; mounted inside `ThreadPrimitive.ViewportFooter`
 * so its height registers as scroll inset — the last message never hides behind it.)
 */
import { ComposerPrimitive, useAuiState } from '@assistant-ui/react';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ComposerToolbar } from './ComposerToolbar';
import { ComposerEditMode } from './ComposerEditMode';
import { useComposerEdit } from './composer-edit-context';
import { ComposerAttachments, ComposerAddAttachment } from '@/components/ui/assistant-ui/attachment';

/** Send (idle, disabled while empty) ↔ Cancel (running) — swapped on thread.isRunning. */
function SendOrCancelButton() {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const base = 'flex size-8 shrink-0 items-center justify-center rounded-full transition-opacity';

  if (isRunning) {
    return (
      <ComposerPrimitive.Cancel
        data-testid="chat-composer-cancel"
        aria-label="Stop"
        className={cn(base, 'bg-foreground text-background hover:opacity-90')}
      >
        <SquareIcon className="size-3 fill-current" />
      </ComposerPrimitive.Cancel>
    );
  }
  return (
    <ComposerPrimitive.Send
      data-testid="chat-composer-send"
      aria-label="Send"
      className={cn(base, 'bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40')}
    >
      <ArrowUpIcon className="size-4" />
    </ComposerPrimitive.Send>
  );
}

export function Composer() {
  const { editing, cancelEdit } = useComposerEdit();
  if (editing) return <ComposerEditMode key={editing.messageId} edit={editing} onDone={cancelEdit} />;

  return (
    <ComposerPrimitive.Root
      data-testid="chat-composer"
      className="rounded-2xl border border-border bg-card shadow-sm transition-colors focus-within:border-ring"
    >
      <ComposerPrimitive.AttachmentDropzone
        data-testid="composer-dropzone"
        className={cn(
          'rounded-2xl transition-colors',
          '[&[data-dragging]]:ring-2 [&[data-dragging]]:ring-primary [&[data-dragging]]:ring-offset-1',
          '[&[data-dragging]]:bg-mf-selection',
        )}
      >
        {/* Attachment tiles — renders nothing (empty:hidden) when no attachments pending */}
        <div data-testid="composer-attachments" className="px-4 pt-3 empty:hidden">
          <ComposerAttachments />
        </div>

        <ComposerPrimitive.Input
          data-testid="chat-composer-input"
          data-noring
          placeholder="Message the assistant…"
          rows={1}
          autoFocus
          className="max-h-48 w-full resize-none bg-transparent px-4 pt-3 pb-1.5 text-body leading-relaxed text-foreground outline-none placeholder:text-mf-text-4"
        />

        <div className="flex items-center justify-between gap-2 px-2.5 pt-1 pb-2.5">
          {/* Left slot: paperclip + config toolbar */}
          <div data-testid="chat-composer-toolbar" className="flex min-h-8 items-center gap-1 text-mf-text-3">
            <ComposerAddAttachment />
            <ComposerToolbar />
          </div>
          <SendOrCancelButton />
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
}
