'use client';

/**
 * useSubmitComposition / useCanSubmit — the one submit path for the
 * multi-quote composer (spec §2.3, 280-A6/A7), shared by all three entry
 * points: the send button, idle Enter (via `ComposerPrimitive.Root`'s composed
 * `onSubmit`), and the mid-run Enter interception in `Composer.tsx`.
 *
 * The two are split because only the enabled/disabled predicate needs the
 * live draft text: `useSubmitComposition` subscribes to nothing but the active
 * thread id, so typing a character no longer re-renders the whole composer —
 * `useCanSubmit` is consumed inside the send button alone.
 *
 * `submit()`'s imperative read of text/attachments/runConfig goes through
 * `readLiveComposerState` (the live `ComposerRuntimeCore`), not the
 * tap-memoized `composer.getState()` snapshot. A stale read here would
 * silently drop the user's just-typed text, worse than the trigger-insertion
 * case that pattern was built for. The composition is read the same way, from
 * the store rather than a subscription, for the same reason.
 *
 * Session references (#240) are folded in HERE, between serialization and
 * append, so the optimistic echo and the daemon receive the identical body —
 * prepending them anywhere downstream would make the rendered message differ
 * from what the CLI was asked. This is also where the draft's bare `@<label>`
 * mentions become the wire `@session[<label>]` tokens the message renderer and
 * the reference lines read. Only labels the draft still mentions survive
 * (`prependSessionReferences` reads the tokens, not the store), so deleting a
 * token deletes its line; the empty-draft early return stays on the
 * pre-prepend text, since a stale record alone is not something to send.
 *
 * `composer.reset()` clears `runConfig` (and role/quote/attachments/text)
 * together (verified against the installed
 * `base-composer-runtime-core.js`), so `runConfig`/`attachments` are read
 * into locals before it runs.
 *
 * `aui.thread.append()` requires `CompleteAttachment[]`, but a
 * freshly-added attachment sits at `status: 'requires-action'` until
 * resolved — native `composer.send()` does this via the registered
 * `AttachmentAdapter.send()` before appending. We bypass `send()` (it can't
 * carry our composed multi-segment text), so `toCompleteAttachment` performs
 * the same status-flip inline; see its docstring for why this is safe
 * without an adapter round-trip.
 */
import { useAui, useAuiState } from '@assistant-ui/react';
import { isDraftSessionId } from '@/store/layout-persist';
import type { EnterWhileRunning } from '@/store/ui-prefs';
import { withSteer } from '../../controller/steer';
import { getDraftConfig } from '@/features/sessions/runtime/draft-config';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import { useActiveThreadId } from '../../runtime/use-active-thread-id';
import { readLiveComposerState } from '../read-live-composer-state';
import { toCompleteAttachment } from '../attachment-adapter';
import { composeMessage } from '../draft-content/compose-message';
import { draftItemsOf, holdSentCaptures, useDraftContent, useDraftItems } from '../draft-content/draft-content-store';
import { prependSessionReferences } from '../../session-references/reference-line';
import { expandSessionMentions } from '../../session-references/session-mention';
import { sessionReferencesFor, useSessionReferences } from '../sessions/session-reference-store';
import { holdUnsent, unsentMetadata } from '../unsent/unsent-store';
import { useComposerSegments } from './segment-store';
import { serializeComposition } from './serialize-composition';

/** `steer` folds the message into the running turn; anything else sends or queues it (C9). */
export type SubmitComposition = (mode?: EnterWhileRunning) => void;

export function useSubmitComposition(): SubmitComposition {
  const aui = useAui();
  const threadId = useActiveThreadId();

  return (mode) => {
    if (threadId == null) return;
    const composer = aui.composer;
    const state = readLiveComposerState(composer);
    const composition = useComposerSegments.getState().byThread[threadId];

    const text = serializeComposition(composition?.committed ?? [], {
      quote: composition?.liveQuote?.text ?? null,
      text: state.text,
    });
    const items = draftItemsOf(threadId);
    if (text === '' && state.attachments.length === 0 && items.length === 0) return;

    const references = sessionReferencesFor(threadId);
    const wireText = expandSessionMentions(text, [...references.keys()]);
    // Captures and code annotations go in last: their block must open the
    // message, and a label inside quoted code is not a session mention.
    const content = composeMessage(prependSessionReferences(wireText, references), items);
    const attachments = [...content.attachments, ...state.attachments.map(toCompleteAttachment)];
    const runConfig = mode === 'steer' ? withSteer(state.runConfig) : state.runConfig;
    // A draft's first message is kept whole; in a session only its captures need keeping.
    const unsentId =
      isDraftSessionId(threadId) && !chatControllerRegistry.get(threadId)?.hasRemoteId()
        ? holdUnsent({
            threadId,
            draft: {
              text: state.text,
              composition,
              items: [...items],
              attachments: [...state.attachments],
              references: Object.fromEntries(references),
            },
            setup: getDraftConfig(threadId),
            sent: attachments,
          })
        : undefined;
    if (!unsentId) holdSentCaptures(threadId, content.captures);
    aui.thread.append({
      role: 'user',
      content: [{ type: 'text', text: content.body }],
      attachments,
      runConfig,
      ...(unsentId ? { metadata: unsentMetadata(unsentId) } : {}),
    });
    composer.reset();
    useComposerSegments.getState().clear(threadId);
    useDraftContent.getState().clear(threadId);
    useSessionReferences.getState().clear(threadId);
  };
}

/** Whether submit() would send anything. worktree-missing is not folded in here — Composer.tsx combines it. */
export function useCanSubmit(): boolean {
  const threadId = useActiveThreadId();
  const composition = useComposerSegments((s) => (threadId ? s.byThread[threadId] : undefined));
  const liveText = useAuiState((s) => s.composer?.text ?? '');
  const itemCount = useDraftItems(threadId).length;
  const liveAttachmentCount = useAuiState((s) => s.composer?.attachments?.length ?? 0);

  const serialized = serializeComposition(composition?.committed ?? [], {
    quote: composition?.liveQuote?.text ?? null,
    text: liveText,
  });
  return serialized !== '' || liveAttachmentCount > 0 || itemCount > 0;
}
