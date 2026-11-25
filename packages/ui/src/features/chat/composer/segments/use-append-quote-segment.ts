/**
 * useAppendQuoteSegment — the one append seam for turning a quote into a
 * segment (spec §2.2). Callers pass the text to quote and, when they know it,
 * where it is from.
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

export function useAppendQuoteSegment(): (quote: string, source?: string) => void {
  const aui = useAui();
  const threadId = useActiveThreadId();
  const append = useComposerSegments((s) => s.append);

  return (quote: string, source?: string) => {
    if (threadId == null) {
      console.warn('[use-append-quote-segment] no active thread — quote dropped');
      return;
    }
    const composer = aui.composer;
    append(threadId, { quote, liveText: readLiveComposerState(composer).text, source });
    composer.setText('');
  };
}
