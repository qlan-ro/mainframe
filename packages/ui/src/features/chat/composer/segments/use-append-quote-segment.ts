/**
 * useAppendQuoteSegment — the one append seam for turning a quote into a
 * segment (spec §2.2). Shared by the selection-toolbar Quote action and the
 * editor's "Add Agent Context" — both just call the returned function with
 * the text to quote.
 *
 * Reads the composer's LIVE text via `__internal_getRuntime` (falls back to
 * `getState()` if it isn't present) rather than `composer.getState()` alone —
 * a same-tick `getState()` read after a `setText` can return stale data (see
 * `ComposerTriggers.tsx`'s `keepDirectoryTokenOpen`). Getting this wrong
 * silently drops whatever the user had typed before quoting.
 */
import { useAui, useAuiState } from '@assistant-ui/react';
import { useComposerSegments } from './segment-store';

export function useAppendQuoteSegment(): (quote: string) => void {
  const aui = useAui();
  const threadId = useAuiState((s: { threadListItem?: { id: string } }) => s.threadListItem?.id);
  const append = useComposerSegments((s) => s.append);

  return (quote: string) => {
    if (threadId == null) {
      console.warn('[use-append-quote-segment] no active thread — quote dropped');
      return;
    }
    const composer = aui.composer();
    const runtime = composer.__internal_getRuntime?.();
    const liveText = runtime ? runtime.getState().text : composer.getState().text;
    append(threadId, { quote, liveText });
    composer.setText('');
  };
}
