/**
 * useAppendQuoteSegment — the one append seam for turning a quote into a
 * segment (spec §2.2). Shared by the selection-toolbar Quote action and the
 * editor's "Add Agent Context" — both just call the returned function with
 * the text to quote.
 *
 * Reads the composer's LIVE text via `readLiveComposerState` rather than
 * `composer.getState()` alone — a same-tick `getState()` read after a
 * `setText` can return stale data. Getting this wrong silently drops whatever
 * the user had typed before quoting.
 */
import { useAui } from '@assistant-ui/react';
import { useActiveThreadId } from '../../runtime/use-active-thread-id';
import { readLiveComposerState } from '../read-live-composer-state';
import { useComposerSegments } from './segment-store';

export function useAppendQuoteSegment(): (quote: string) => void {
  const aui = useAui();
  const threadId = useActiveThreadId();
  const append = useComposerSegments((s) => s.append);

  return (quote: string) => {
    if (threadId == null) {
      console.warn('[use-append-quote-segment] no active thread — quote dropped');
      return;
    }
    const composer = aui.composer;
    append(threadId, { quote, liveText: readLiveComposerState(composer).text });
    composer.setText('');
  };
}
