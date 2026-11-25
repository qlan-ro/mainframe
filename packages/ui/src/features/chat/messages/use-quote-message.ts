import { useAui } from '@assistant-ui/react';
import { readLiveComposerState } from '../composer/read-live-composer-state';
import { useComposerSegments } from '../composer/segments/segment-store';
import { useActiveThreadId } from '../runtime/use-active-thread-id';

/**
 * Quotes a whole message into the composer, with where it is from. Inside a message the aui context's
 * `composer` is that message's edit composer, so the thread's is reached
 * through `threads`, a root scope no message rebinds.
 */
export function useQuoteMessage(): (quote: string, source?: string) => void {
  const aui = useAui();
  const threadId = useActiveThreadId();
  const append = useComposerSegments((s) => s.append);
  return (quote, source) => {
    if (threadId == null) return;
    const composer = aui.threads.thread('main').composer();
    append(threadId, { quote, liveText: readLiveComposerState(composer).text, source });
    composer.setText('');
  };
}
