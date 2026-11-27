import { useEffect } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { ArrowUpIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SCROLLBAR_DRAG_EVENT } from '@/lib/overlay-scrollbars/thumb';
import { useChatExtras } from '../runtime/chat-extras';
import { useTranscriptScroll } from './transcript-scroll-context';

import { usePrependAnchor } from './use-prepend-anchor';
import { useDelayedVisible } from './use-delayed-visible';
export { HISTORY_PREPEND_EVENT } from './use-prepend-anchor';

const SCROLL_GESTURES = ['wheel', 'touchmove', 'keydown', SCROLLBAR_DRAG_EVENT];

/** A fast page must not flash the indicator: once it shows it stays this long. */
export const LOADING_MIN_VISIBLE_MS = 300;

export function EarlierMessages() {
  const extras = useChatExtras();
  const scroll = useTranscriptScroll();
  const firstId = useAuiState((s) => s.thread.messages[0]?.id);
  const history = extras?.state.historyWindow;
  const anchoring = usePrependAnchor(firstId, extras?.state.chatId, history?.floorItemId);
  const loading = history?.loading === true || anchoring;
  const held = useDelayedVisible(loading, {
    delay: 0,
    minVisible: LOADING_MIN_VISIBLE_MS,
    resetKey: extras?.state.chatId,
  });
  useOlderPageGesture(extras?.loadEarlier, history?.hasMore === true, loading);
  if (!firstId) return null;
  if (scroll?.owned) {
    return (
      <OwnedBoundary
        loading={held}
        hasMore={history?.hasMore === true}
        error={history?.error}
        load={extras?.loadEarlier}
      />
    );
  }
  return (
    <div
      data-testid="chat-history-boundary"
      className="flex min-h-12 flex-col items-center py-2 text-xs text-muted-foreground"
      aria-live="polite"
      aria-busy={loading}
    >
      {loading ? (
        <span>Loading earlier messages...</span>
      ) : history?.hasMore ? (
        <Button
          data-testid="chat-load-earlier"
          variant="ghost"
          size="sm"
          onClick={() => {
            void extras?.loadEarlier?.().catch(() => undefined);
          }}
        >
          Earlier messages
        </Button>
      ) : (
        <span>Beginning of conversation</span>
      )}
      {history?.error && <span role="alert">{history.error}</span>}
    </div>
  );
}

/**
 * The top of the plain list. Its height is the same in every state (a loading spinner, the
 * cue that more is above, the start of the chat), so it never moves the rows under the reader
 * when it changes.
 */
function OwnedBoundary({
  loading,
  hasMore,
  error,
  load,
}: {
  loading: boolean;
  hasMore: boolean;
  error: string | undefined;
  load: ((target?: string) => Promise<boolean>) | undefined;
}) {
  const state = loading ? 'loading' : hasMore ? 'more' : 'start';
  return (
    <div
      data-testid="chat-history-boundary"
      data-state={state}
      className="flex h-12 items-center justify-center gap-2 text-xs text-muted-foreground"
      aria-live="polite"
      aria-busy={loading}
    >
      {error && !loading ? (
        <span role="alert" className="truncate">
          {error}
        </span>
      ) : loading ? (
        <>
          <Spinner data-testid="chat-history-spinner" aria-label="Loading earlier messages" className="size-3.5" />
          <span>Loading earlier messages</span>
        </>
      ) : hasMore ? (
        <Button
          data-testid="chat-load-earlier"
          variant="ghost"
          size="sm"
          onClick={() => {
            void load?.().catch(() => undefined);
          }}
        >
          <ArrowUpIcon />
          Earlier messages
        </Button>
      ) : (
        <span>Beginning of conversation</span>
      )}
    </div>
  );
}

function useOlderPageGesture(
  load: ((target?: string) => Promise<boolean>) | undefined,
  hasMore: boolean,
  loading: boolean,
) {
  const scroll = useTranscriptScroll();
  useEffect(() => {
    const viewport = scroll?.viewportElement.current;
    if (!viewport || !hasMore || loading || !load) return;
    let armed = false;
    const check = () => {
      if (!armed || viewport.scrollTop > viewport.clientHeight) return;
      armed = false;
      void load().catch(() => undefined);
    };
    const gesture = (event: Event) => {
      if ((event.target as Element).closest('input, textarea, [contenteditable="true"]')) return;
      if (event instanceof KeyboardEvent && !['ArrowUp', 'PageUp', 'Home'].includes(event.key)) return;
      if (event instanceof WheelEvent && event.deltaY >= 0) return;
      armed = true;
      check();
    };
    for (const name of SCROLL_GESTURES) viewport.addEventListener(name, gesture, { passive: true });
    viewport.addEventListener('scroll', check, { passive: true });
    return () => {
      for (const name of SCROLL_GESTURES) viewport.removeEventListener(name, gesture);
      viewport.removeEventListener('scroll', check);
    };
  }, [load, hasMore, loading, scroll]);
}
