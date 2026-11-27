'use client';

/**
 * The composer's text field: the textarea under its colour overlay, or, with
 * the "Mentions and commands as chips" setting on (`ui-prefs.chipComposer`),
 * the Lexical chip field. The chip field loads on first use, so with the
 * setting off nothing about the textarea path changes.
 */
import { Suspense, useCallback, useMemo, type RefObject, type KeyboardEvent } from 'react';
import { ComposerPrimitive } from '@assistant-ui/react';
import { useUiPrefs } from '@/store/ui-prefs';
import { useTriggerFieldAria } from './triggers/trigger-field-aria-context';
import { focusOwningTranscript } from './focus-composer';
import { ComposerHighlight } from './highlight/ComposerHighlight';
import { createLexicalComposerBridge, type LexicalComposerBridge } from './lexical/lexical-bridge';
import { LazyComposerLexicalField } from './lexical/lazy-fields';

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
      unstable_focusOnThreadSwitched={false}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      rows={1}
      autoFocus
      className="relative block w-full resize-none overflow-hidden bg-transparent px-1 pt-0.5 pb-2 font-sans text-composer-input text-transparent caret-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
      {...triggerAria}
    />
  );
}

/** The card's chip-field bridge while the setting is on; null for the textarea. A new one per switch. */
export function useChipFieldBridge(): LexicalComposerBridge | null {
  const chips = useUiPrefs((s) => s.chipComposer);
  return useMemo(() => (chips ? createLexicalComposerBridge() : null), [chips]);
}

/** Holds the field's first line while the chip field loads, so the card does not jump. */
function ChipFieldFallback({ placeholder }: { placeholder: string }) {
  return (
    <div aria-hidden className="px-1 pt-0.5 pb-2 font-sans text-composer-input text-muted-foreground">
      {placeholder}
    </div>
  );
}

export function ComposerField({
  bridge,
  textareaRef,
  placeholder,
  onKeyDown,
  onEnter,
  onShiftTab,
}: {
  bridge: LexicalComposerBridge | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  /** The textarea's key handler (mid-run Enter, ⇧⇥). */
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** The chip field's ↵: it sends through the card, idle or running. */
  onEnter: (altKey: boolean) => void;
  onShiftTab: () => void;
}) {
  if (!bridge) {
    return (
      <>
        <ComposerHighlight />
        <ComposerInputField textareaRef={textareaRef} onKeyDown={onKeyDown} placeholder={placeholder} />
      </>
    );
  }
  return (
    <Suspense fallback={<ChipFieldFallback placeholder={placeholder} />}>
      <LazyComposerLexicalField bridge={bridge} placeholder={placeholder} onEnter={onEnter} onShiftTab={onShiftTab} />
    </Suspense>
  );
}
