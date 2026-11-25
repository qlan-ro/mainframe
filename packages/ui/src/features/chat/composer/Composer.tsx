'use client';

/**
 * Composer shell — one card over the native `ComposerPrimitive`, with a strip
 * tucked behind its top edge (K1, K2). The bare row under it is the footer's
 * (`BottomStrip`): a chat with no composer has it too.
 *
 * Native ~90%: Root/Input own the draft + submit. The card holds, top to
 * bottom, the queue (C10), the draft's attachments and quotes, the field, and
 * the toolbar: `+`, model, permissions, context ring, Stop / Send (C4).
 *
 * Mounted inside `ThreadPrimitive.ViewportFooter` so its height registers as
 * scroll inset — the last message never hides behind it.
 */
import { useCallback, useRef, useState, type RefObject, type KeyboardEvent } from 'react';
import { ComposerPrimitive, useAuiState } from '@assistant-ui/react';
import { cn } from '@/lib/utils';
import { ComposerToolbar, type ComposerToolbarHandle } from './config-toolbar/ComposerToolbar';
import { ContextRing } from './config-toolbar/ContextRing';
import { ComposerCardProvider } from './composer-card-context';
import { ComposerEditMode } from './edit/ComposerEditMode';
import { useComposerEdit } from './edit/composer-edit-context';
import { ComposerAddMenu } from './attachments/ComposerAddMenu';
import { ComposerAttachments } from './attachments/ComposerAttachmentStrip';
import { useActiveThreadId } from '../runtime/use-active-thread-id';
import { ComposerTriggers } from './triggers/ComposerTriggers';
import { useTriggerFieldAria } from './triggers/trigger-field-aria-context';
import { focusOwningTranscript } from './focus-composer';
import { ComposerHighlight } from './highlight/ComposerHighlight';
import { QueuedRows } from './queue/QueuedRows';
import { ComposerSegments } from './segments/ComposerSegments';
import { useComposerSegments } from './segments/segment-store';
import { useSubmitComposition } from './segments/use-submit-composition';
import { SendControls } from './send/SendControls';
import { useEnterMode } from './send/use-enter-mode';
import { UnsentNotices } from './unsent/UnsentNotices';
import { TopStrip } from './strips/TopStrip';

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
      className="relative block w-full resize-none overflow-hidden bg-transparent px-1 pt-0.5 pb-2 font-sans text-composer-input text-transparent caret-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
      {...triggerAria}
    />
  );
}

/** What an empty field says (C7). */
function usePlaceholder(hasLiveQuote: boolean): string {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const started = useAuiState((s) => s.thread.messages.length > 0);
  const enter = useEnterMode();
  if (hasLiveQuote) return 'Add a message…';
  if (isRunning) {
    return enter === 'steer' ? 'Steer the agent, ⌥↵ to queue…' : 'Queue a message for when the agent finishes…';
  }
  return started ? 'Reply to the agent…' : 'Ask anything, @ to mention, / for actions';
}

export function Composer({ variant = 'main' }: { variant?: 'main' | 'side' } = {}) {
  const { editing, cancelEdit } = useComposerEdit();
  const [card, setCard] = useState<HTMLElement | null>(null);

  return (
    <ComposerCardProvider value={card}>
      <div data-testid="chat-composer-frame" className="@container/composer flex min-h-0 min-w-0 flex-col">
        {variant !== 'side' && <TopStrip />}
        {editing ? (
          <ComposerEditMode key={editing.messageId} edit={editing} onDone={cancelEdit} />
        ) : (
          <ComposerCard variant={variant} cardRef={setCard} />
        )}
      </div>
    </ComposerCardProvider>
  );
}

function ComposerCard({
  variant,
  cardRef,
}: {
  variant: 'main' | 'side';
  cardRef: (element: HTMLFormElement | null) => void;
}) {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const threadId = useActiveThreadId();
  const hasLiveQuote = useComposerSegments((s) =>
    threadId ? (s.byThread[threadId]?.liveQuote ?? null) !== null : false,
  );
  const submit = useSubmitComposition();
  const enterWhileRunning = useEnterMode();
  const placeholder = usePlaceholder(hasLiveQuote);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toolbarRef = useRef<ComposerToolbarHandle>(null);

  // Mid-run Enter. The native ComposerPrimitive.Input gates Enter off while
  // running unless `thread.capabilities.queue` is set — and that is false for
  // us because we use the daemon-backed queue, not assistant-ui's own. So the
  // key is handled here: submit() ignores isRunning and routes through
  // append() → onNew → controller.sendMessage, which queues the message or
  // folds it into the turn. ⌥↵ does the other of the two (C9).
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing || e.defaultPrevented) return;
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        toolbarRef.current?.cyclePermission();
        return;
      }
      if (!isRunning || e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      const steer = (enterWhileRunning === 'steer') !== e.altKey;
      try {
        submit(steer ? 'steer' : 'queue');
      } catch (err) {
        console.warn('[composer] mid-run send failed', err);
      }
    },
    [isRunning, submit, enterWhileRunning],
  );

  return (
    <ComposerTriggers textareaRef={textareaRef}>
      <ComposerPrimitive.Root
        ref={cardRef}
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
        // `z-1` keeps it over the strip tucked behind its top edge. The focus
        // line is the FIELD's: a focused toolbar control draws its own.
        className="relative z-1 min-h-0 min-w-60 overflow-y-auto rounded-[16px] bg-card shadow-card transition-colors has-[textarea:focus-visible]:focus-line-inset"
      >
        <ComposerPrimitive.AttachmentDropzone
          data-testid="composer-dropzone"
          className={cn(
            'rounded-[16px] px-2.5 pt-2.5 pb-2 transition-colors @max-[400px]/composer:px-2 @max-[400px]/composer:pt-2 @max-[400px]/composer:pb-1.5',
            '[&[data-dragging]]:ring-2 [&[data-dragging]]:ring-primary [&[data-dragging]]:ring-offset-1',
            '[&[data-dragging]]:bg-sidebar-selection',
          )}
        >
          <QueuedRows />
          <UnsentNotices />
          {/* Pending attachment tiles — the strip owns its own empty:hidden. */}
          <ComposerAttachments />

          {/* Committed quote+prose segments + the pending live-quote pill (multi-quote composer, #280).
              Mounted above the scroll-wrapper, never inside it — that wrapper is ComposerHighlight's
              absolute-positioning parent. */}
          {threadId && <ComposerSegments threadId={threadId} />}

          {/* Scroll-wrapper owns max-h + overflow so overlay and textarea wrap/scroll together. */}
          <div className="relative max-h-48 overflow-y-auto">
            <ComposerHighlight />
            <ComposerInputField textareaRef={textareaRef} onKeyDown={handleInputKeyDown} placeholder={placeholder} />
          </div>

          <div
            data-testid="chat-composer-toolbar"
            className="flex min-w-0 items-center gap-0.5 @max-[320px]/composer:flex-wrap @max-[320px]/composer:gap-x-0 @max-[320px]/composer:gap-y-2"
          >
            <ComposerAddMenu textareaRef={textareaRef} />
            <ComposerToolbar ref={toolbarRef} variant={variant} />
            <span className="min-w-0 flex-1" aria-hidden />
            {/* Below 320px this group wraps onto its own row, so nothing truncates. */}
            <div className="flex shrink-0 items-center gap-0.5 @max-[320px]/composer:ml-auto @max-[320px]/composer:gap-0">
              <ContextRing />
              <SendControls submit={submit} />
            </div>
          </div>
        </ComposerPrimitive.AttachmentDropzone>
      </ComposerPrimitive.Root>
    </ComposerTriggers>
  );
}
