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
import { useCallback } from 'react';
import { ComposerPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ComposerToolbar } from './config-toolbar/ComposerToolbar';
import { ComposerEditMode } from './edit/ComposerEditMode';
import { useComposerEdit } from './edit/composer-edit-context';
import {
  ComposerAttachments,
  ComposerAddAttachment,
  ComposerAddMention,
} from '@/components/ui/assistant-ui/attachment';
import { ComposerQuotePreview } from '@/components/ui/assistant-ui/quote';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';
import { ComposerTriggers } from './triggers/ComposerTriggers';
import { ComposerHighlight } from './highlight/ComposerHighlight';

/** Send (idle, disabled while empty or worktree-missing) ↔ Cancel (running) — swapped on thread.isRunning. */
function SendOrCancelButton({ sendDisabled }: { sendDisabled?: boolean }) {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const base = 'flex size-[26px] shrink-0 items-center justify-center rounded-md transition-opacity';

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
      disabled={sendDisabled}
      className={cn(base, 'bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40')}
    >
      <ArrowUpIcon className="size-3.5" />
    </ComposerPrimitive.Send>
  );
}

export function Composer() {
  const { editing, cancelEdit } = useComposerEdit();
  const chat = useChatExtras()?.state.chatConfig ?? null;
  const worktreeMissing = chat?.worktreeMissing ?? false;
  const aui = useAui();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const hasQuote = useAuiState((s) => s.composer.quote != null);

  // Mid-run Enter-to-queue. The native ComposerPrimitive.Input gates Enter off
  // while running unless `thread.capabilities.queue` is set — and that is false
  // for us because we use the daemon-backed queue, not assistant-ui's native
  // Queue adapter. So intercept Enter ourselves and send directly: the composer's
  // `send()` ignores isRunning, routes through `onNew` → controller.sendMessage,
  // and the daemon enqueues the message behind the in-flight run (mirrors desktop).
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isRunning || worktreeMissing) return;
      if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
      e.preventDefault();
      try {
        aui.composer().send();
      } catch (err) {
        console.warn('[composer] mid-run queued send failed', err);
      }
    },
    [aui, isRunning, worktreeMissing],
  );

  if (editing) return <ComposerEditMode key={editing.messageId} edit={editing} onDone={cancelEdit} />;

  return (
    <ComposerTriggers>
      <ComposerPrimitive.Root
        data-testid="chat-composer"
        data-tut="composer"
        className="min-w-[240px] rounded-xl [border-width:0.5px] border-border bg-card shadow-sm transition-colors focus-within:border-ring"
      >
        <ComposerPrimitive.AttachmentDropzone
          data-testid="composer-dropzone"
          disabled={worktreeMissing}
          className={cn(
            'rounded-xl transition-colors',
            '[&[data-dragging]]:ring-2 [&[data-dragging]]:ring-primary [&[data-dragging]]:ring-offset-1',
            '[&[data-dragging]]:bg-mf-selection',
          )}
        >
          {/* Quote pill — renders only when a quote is set (select-to-quote). */}
          <ComposerQuotePreview />

          {/* Attachment tiles — renders nothing (empty:hidden) when no attachments pending */}
          <div data-testid="composer-attachments" className="px-[14px] pt-[10px] empty:hidden">
            <ComposerAttachments />
          </div>

          {/* Scroll-wrapper owns max-h + overflow so overlay and textarea wrap/scroll together. */}
          <div className="relative max-h-48 overflow-y-auto">
            <ComposerHighlight />
            <ComposerPrimitive.Input
              data-testid="chat-composer-input"
              data-mf-composer-input
              data-noring
              disabled={worktreeMissing}
              onKeyDown={handleInputKeyDown}
              placeholder={hasQuote ? 'Add a message…' : 'Reply to Mainframe…'}
              rows={1}
              autoFocus
              className="relative w-full resize-none overflow-hidden bg-transparent px-[14px] pt-[10px] pb-[4px] font-sans text-body leading-relaxed text-transparent caret-foreground outline-none placeholder:text-mf-text-4 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="@container flex items-center justify-between gap-2 px-2.5 pt-[4px] pb-[6px]">
            {/* Left slot: paperclip + mention + separator + config toolbar */}
            <div data-testid="chat-composer-toolbar" className="flex min-w-0 min-h-8 items-center gap-1 text-mf-text-3">
              <ComposerAddAttachment />
              <ComposerAddMention />
              {/* 1×12px hairline divider separating attachment actions from config chips */}
              <div className="mx-1 h-3 w-px shrink-0 bg-border" aria-hidden />
              <ComposerToolbar />
            </div>
            <SendOrCancelButton sendDisabled={worktreeMissing} />
          </div>
        </ComposerPrimitive.AttachmentDropzone>
      </ComposerPrimitive.Root>
    </ComposerTriggers>
  );
}
