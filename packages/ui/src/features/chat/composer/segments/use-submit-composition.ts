'use client';

/**
 * useSubmitComposition — the one submit path for the multi-quote composer
 * (spec §2.3, 280-A6/A7), shared by all three entry points: the send button,
 * idle Enter (via `ComposerPrimitive.Root`'s composed `onSubmit`), and the
 * mid-run Enter interception in `Composer.tsx`.
 *
 * `submit()`'s imperative read of text/attachments/runConfig goes through
 * `__internal_getRuntime()` (the live `ComposerRuntimeCore`), not the
 * tap-memoized `composer.getState()` snapshot — mirrors
 * `use-append-quote-segment.ts`. A stale read here would silently drop the
 * user's just-typed text, worse than the trigger-insertion case that pattern
 * was built for.
 *
 * `composer.reset()` clears `runConfig` (and role/quote/attachments/text)
 * together (verified against the installed
 * `base-composer-runtime-core.js`), so `runConfig`/`attachments` are read
 * into locals before it runs.
 *
 * `aui.thread().append()` requires `CompleteAttachment[]`, but a
 * freshly-added attachment sits at `status: 'requires-action'` until
 * resolved — native `composer.send()` does this via the registered
 * `AttachmentAdapter.send()` before appending. We bypass `send()` (it can't
 * carry our composed multi-segment text), so `toCompleteAttachment` performs
 * the same status-flip inline; see its docstring for why this is safe
 * without an adapter round-trip.
 */
import { useAui, useAuiState } from '@assistant-ui/react';
import { toCompleteAttachment } from '../attachment-adapter';
import { useComposerSegments } from './segment-store';
import { serializeComposition } from './serialize-composition';

interface SubmitComposition {
  submit: () => void;
  /** worktree-missing is not folded in here — Composer.tsx combines it. */
  canSubmit: boolean;
}

export function useSubmitComposition(): SubmitComposition {
  const aui = useAui();
  const threadId = useAuiState((s: { threadListItem?: { id: string } }) => s.threadListItem?.id);
  const composition = useComposerSegments((s) => (threadId ? s.byThread[threadId] : undefined));
  const clear = useComposerSegments((s) => s.clear);
  const liveText = useAuiState((s: { composer?: { text?: string } }) => s.composer?.text ?? '');
  const liveAttachmentCount = useAuiState(
    (s: { composer?: { attachments?: readonly unknown[] } }) => s.composer?.attachments?.length ?? 0,
  );

  const committed = composition?.committed ?? [];
  const liveQuote = composition?.liveQuote?.text ?? null;
  const canSubmit = serializeComposition(committed, { quote: liveQuote, text: liveText }) !== '' || liveAttachmentCount > 0;

  const submit = () => {
    if (threadId == null) return;
    const composer = aui.composer();
    const runtime = composer.__internal_getRuntime?.();
    const state = runtime ? runtime.getState() : composer.getState();

    const text = serializeComposition(committed, { quote: liveQuote, text: state.text });
    if (text === '' && state.attachments.length === 0) return;

    const attachments = state.attachments.map(toCompleteAttachment);
    const runConfig = state.runConfig;
    aui.thread().append({ role: 'user', content: [{ type: 'text', text }], attachments, runConfig });
    composer.reset();
    clear(threadId);
  };

  return { submit, canSubmit };
}
