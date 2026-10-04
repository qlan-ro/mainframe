'use client';

/**
 * Composer shell — the v2 skin over the native `ComposerPrimitive`.
 *
 * Native ~90%: Root/Input own the draft + submit. The send slot shows send
 * only — Stop lives on the status line above the composer (D18) — and a
 * mid-run Enter still queues. The bottom bar's left slot carries the
 * attachment affordances and the config toolbar (model · permission · plan ·
 * temporary · worktree · context).
 *
 * (Decomposed out of ChatThread; mounted inside `ThreadPrimitive.ViewportFooter`
 * so its height registers as scroll inset — the last message never hides behind it.)
 */
import { useCallback, useRef, type RefObject, type KeyboardEvent } from 'react';
import { ComposerPrimitive, useAuiState } from '@assistant-ui/react';
import { ArrowUpIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { ComposerToolbar } from './config-toolbar/ComposerToolbar';
import { ComposerEditMode } from './edit/ComposerEditMode';
import { useComposerEdit } from './edit/composer-edit-context';
import { ComposerAttachments, ComposerAddAttachment, ComposerAddMention } from './attachments/ComposerAttachmentStrip';
import { useActiveThreadId } from '../runtime/use-active-thread-id';
import { ComposerTriggers } from './triggers/ComposerTriggers';
import { useTriggerFieldAria } from './triggers/trigger-field-aria-context';
import { focusOwningTranscript } from './focus-composer';
import { ComposerHighlight } from './highlight/ComposerHighlight';
import { ComposerSegments } from './segments/ComposerSegments';
import { useComposerSegments } from './segments/segment-store';
import { useSubmitComposition, useCanSubmit } from './segments/use-submit-composition';

/**
 * Send — a 32px `primary` square, disabled while empty. While a turn runs it
 * stays a send: Enter queues, and so does this.
 *
 * `useCanSubmit` is subscribed HERE, not in `Composer`: it reads the live
 * draft text, so hoisting it would re-render the whole composer (segments,
 * triggers, toolbar, highlight overlay) on every keystroke.
 */
function SendButton() {
  const canSubmit = useCanSubmit();
  return (
    <Button type="submit" data-testid="chat-composer-send" aria-label="Send" size="icon-sm" disabled={!canSubmit}>
      <ArrowUpIcon />
    </Button>
  );
}

/**
 * The textarea, split out so `useTriggerFieldAria()` resolves correctly:
 * `ComposerTriggers`'s provider is this element's ANCESTOR once mounted, but
 * only because THIS component's own render — not `Composer`'s — is what ends
 * up nested under it. Calling the hook in `Composer` directly reads it one
 * render too early, from `Composer`'s own tree position, above
 * `ComposerTriggers` entirely (`Composer` renders `ComposerTriggers`, not the
 * other way around) — props are baked at element-creation time and don't
 * recompute once the element mounts somewhere else.
 */
function ComposerInputField({
  textareaRef,
  onKeyDown,
  placeholder,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
}) {
  const triggerAria = useTriggerFieldAria();
  // Escape leaves the composer and parks focus on the transcript (⌘L brings it
  // back). The `/` and `@` trigger menu owns Escape while a token is armed —
  // even with no matching entries, the trigger hook still consumes Escape to
  // disarm itself and calls preventDefault() on the SAME native event before
  // this handler runs (assistant-ui's plugin registry is consulted from a
  // document-level CAPTURE listener, which always fires before this bubble-
  // phase handler). Gating on `e.defaultPrevented` reads that fact off the
  // event itself; a React-context "armed" flag was tried first and dropped —
  // the trigger's own preventDefault() can land a state update (closing the
  // token) whose re-render commits, via a microtask checkpoint, in the gap
  // between the two listeners, so the context value this handler closes over
  // is already stale by the time it runs. No preventDefault of our own here:
  // the session panel and files panel dismiss themselves on a document-level
  // Escape listener gated on `!event.defaultPrevented`, and React's synthetic
  // handler (attached below `document`) would otherwise stand them down
  // before that listener runs.
  //
  // `cancelOnEscape={false}` below turns off aui's OWN document-level Escape
  // handler (`useEscapeKeydown` in ComposerPrimitive.Input), which calls the
  // runtime's onCancel whenever `composer.canCancel` is true — and aui's
  // "cancel" capability is `onCancel !== undefined`, a static flag for
  // "the app supports cancelling", not `isRunning` (verified against
  // ExternalStoreThreadRuntimeCore's capabilities.cancel). So it fires on
  // every idle-chat Escape too: our onCancel calls controller.cancel(), which
  // optimistically marks the run cancelling; on a chat with nothing to
  // interrupt the daemon never broadcasts a stop, and the client-side
  // "Working…" indicator strands running. Escape stays focus-park only; the
  // Stop button is the one real way to cancel a run.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape' && !e.defaultPrevented && focusOwningTranscript(e.currentTarget)) {
        return;
      }
      onKeyDown(e);
    },
    [onKeyDown],
  );
  return (
    <ComposerPrimitive.Input
      ref={textareaRef}
      data-testid="chat-composer-input"
      data-mf-composer-input
      data-noring
      cancelOnEscape={false}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      rows={1}
      autoFocus
      className="relative w-full resize-none overflow-hidden bg-transparent px-3.5 pt-2.5 pb-1 font-sans text-sm leading-relaxed text-transparent caret-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
      {...triggerAria}
    />
  );
}

export function Composer({ variant = 'main' }: { variant?: 'main' | 'side' } = {}) {
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
        onSubmit={(e) => {
          // Load-bearing, not boilerplate: aui composes its own onSubmit
          // (which calls composer.send()) with ours via checkForDefaultPrevented,
          // so dropping this preventDefault double-sends every Enter.
          e.preventDefault();
          submit();
        }}
        // `min-h-0 overflow-y-auto`: the thread footer shrinks this element,
        // not just its wrapper, when an expanded gate and a tall draft
        // compete for the same pane (#336) — without `min-h-0` a flex item's
        // automatic minimum is its content size, so it would overflow the
        // footer's cap instead of shrinking to fit; `overflow-y-auto` clips
        // that content rather than letting it paint past the card's border.
        className="min-h-0 min-w-60 overflow-y-auto rounded-xl border border-input bg-card shadow-xs transition-colors [scrollbar-width:none] focus-within:border-ring"
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
            <ComposerInputField
              textareaRef={textareaRef}
              onKeyDown={handleInputKeyDown}
              placeholder={hasLiveQuote ? 'Add a message…' : 'Reply to the agent…'}
            />
          </div>

          <div className="@container flex items-center justify-between gap-2 px-2.5 pt-1 pb-1.5">
            {/* Left slot: paperclip + mention + separator + config toolbar */}
            <div
              data-testid="chat-composer-toolbar"
              className="flex min-h-8 min-w-0 items-center gap-1 text-muted-foreground"
            >
              <ComposerAddAttachment />
              <ComposerAddMention textareaRef={textareaRef} />
              {/* Hairline separating the attachment actions from the config chips. */}
              <Separator orientation="vertical" className="mx-1 h-3 data-vertical:self-center" />
              <ComposerToolbar variant={variant} />
            </div>
            <SendButton />
          </div>
        </ComposerPrimitive.AttachmentDropzone>
      </ComposerPrimitive.Root>
    </ComposerTriggers>
  );
}
