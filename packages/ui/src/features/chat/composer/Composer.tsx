'use client';

/**
 * Composer shell — the v2 skin over the native `ComposerPrimitive`.
 *
 * Native ~90%: Root/Input own the draft + submit; Send↔Cancel swaps on
 * `thread.isRunning`. The bottom bar's left slot carries the attachment
 * affordances and the config toolbar (model · plan · permission · worktree).
 *
 * (Decomposed out of ChatThread; mounted inside `ThreadPrimitive.ViewportFooter`
 * so its height registers as scroll inset — the last message never hides behind it.)
 */
import { useCallback, useRef } from 'react';
import { ComposerPrimitive, useAuiState } from '@assistant-ui/react';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Separator } from '@v2/components/ui/separator';
import { cn } from '@v2/lib/utils';
import { ComposerToolbar } from './config-toolbar/ComposerToolbar';
import { ComposerEditMode } from './edit/ComposerEditMode';
import { useComposerEdit } from './edit/composer-edit-context';
import { ComposerAttachments, ComposerAddAttachment, ComposerAddMention } from './attachments/ComposerAttachmentStrip';
import { useActiveThreadId } from '../runtime/use-active-thread-id';
import { ComposerTriggers } from './triggers/ComposerTriggers';
import { ComposerHighlight } from './highlight/ComposerHighlight';
import { ComposerSegments } from './segments/ComposerSegments';
import { useComposerSegments } from './segments/segment-store';
import { useSubmitComposition, useCanSubmit } from './segments/use-submit-composition';

/**
 * Send (idle, disabled while empty) ↔ Cancel (running) — swapped on
 * thread.isRunning.
 *
 * `useCanSubmit` is subscribed HERE, not in `Composer`: it reads the live
 * draft text, so hoisting it would re-render the whole composer (segments,
 * triggers, toolbar, highlight overlay) on every keystroke.
 */
function SendOrCancelButton() {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const canSubmit = useCanSubmit();

  if (isRunning) {
    // The composer's Stop gets a soft destructive fill — it swaps in for the
    // primary Send, so it must read as THE action, unlike the ghost stops on
    // WorkspaceTabPill / ToolbarLaunchControls which are incidental chrome.
    return (
      <ComposerPrimitive.Cancel asChild>
        <Button
          data-testid="chat-composer-cancel"
          aria-label="Stop"
          variant="ghost"
          size="icon-xs"
          className="bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
        >
          <SquareIcon fill="currentColor" />
        </Button>
      </ComposerPrimitive.Cancel>
    );
  }
  return (
    <Button type="submit" data-testid="chat-composer-send" aria-label="Send" size="icon-xs" disabled={!canSubmit}>
      <ArrowUpIcon />
    </Button>
  );
}

export function Composer() {
  const { editing, cancelEdit } = useComposerEdit();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const threadId = useActiveThreadId();
  const hasLiveQuote = useComposerSegments((s) =>
    threadId ? (s.byThread[threadId]?.liveQuote ?? null) !== null : false,
  );
  const submit = useSubmitComposition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Mid-run Enter-to-queue. The native ComposerPrimitive.Input gates Enter off
  // while running unless `thread.capabilities.queue` is set — and that is false
  // for us because we use the daemon-backed queue, not assistant-ui's native
  // Queue adapter. So intercept Enter ourselves and submit directly: submit()
  // ignores isRunning, routes through append() → onNew → controller.sendMessage,
  // and the daemon enqueues the message behind the in-flight run (mirrors desktop).
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isRunning) return;
      if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
      e.preventDefault();
      try {
        submit();
      } catch (err) {
        console.warn('[composer] mid-run queued send failed', err);
      }
    },
    [isRunning, submit],
  );

  if (editing) return <ComposerEditMode key={editing.messageId} edit={editing} onDone={cancelEdit} />;

  return (
    <ComposerTriggers textareaRef={textareaRef}>
      <ComposerPrimitive.Root
        data-testid="chat-composer"
        data-tut="composer"
        onSubmit={(e) => {
          // Load-bearing, not boilerplate: aui composes its own onSubmit
          // (which calls composer.send()) with ours via checkForDefaultPrevented,
          // so dropping this preventDefault double-sends every Enter.
          e.preventDefault();
          submit();
        }}
        className="min-w-60 rounded-xl border border-border bg-card shadow-sm transition-colors focus-within:border-ring"
      >
        <ComposerPrimitive.AttachmentDropzone
          data-testid="composer-dropzone"
          className={cn(
            'rounded-xl transition-colors',
            '[&[data-dragging]]:ring-2 [&[data-dragging]]:ring-primary [&[data-dragging]]:ring-offset-1',
            '[&[data-dragging]]:bg-sidebar-selection',
          )}
        >
          {/* Pending attachment tiles — the strip owns its own empty:hidden. */}
          <ComposerAttachments />

          {/* Committed quote+prose segments + the pending live-quote pill (multi-quote composer, #280).
              Mounted above the scroll-wrapper, never inside it — that wrapper is ComposerHighlight's
              absolute-positioning parent. */}
          {threadId && <ComposerSegments threadId={threadId} />}

          {/* Scroll-wrapper owns max-h + overflow so overlay and textarea wrap/scroll together. */}
          <div className="relative max-h-48 overflow-y-auto">
            <ComposerHighlight />
            <ComposerPrimitive.Input
              ref={textareaRef}
              data-testid="chat-composer-input"
              data-mf-composer-input
              data-noring
              onKeyDown={handleInputKeyDown}
              placeholder={hasLiveQuote ? 'Add a message…' : 'Reply to Mainframe…'}
              rows={1}
              autoFocus
              className="relative w-full resize-none overflow-hidden bg-transparent px-3.5 pt-2.5 pb-1 font-sans text-sm leading-relaxed text-transparent caret-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="@container flex items-center justify-between gap-2 px-2.5 pt-1 pb-1.5">
            {/* Left slot: paperclip + mention + separator + config toolbar */}
            <div
              data-testid="chat-composer-toolbar"
              className="flex min-h-8 min-w-0 items-center gap-1 text-muted-foreground"
            >
              <ComposerAddAttachment />
              <ComposerAddMention />
              {/* Hairline separating the attachment actions from the config chips. */}
              <Separator orientation="vertical" className="mx-1 h-3 self-auto" />
              <ComposerToolbar />
            </div>
            <SendOrCancelButton />
          </div>
        </ComposerPrimitive.AttachmentDropzone>
      </ComposerPrimitive.Root>
    </ComposerTriggers>
  );
}
