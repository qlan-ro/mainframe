import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { ArrowUpIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SCROLLBAR_DRAG_EVENT } from '@/lib/overlay-scrollbars/thumb';
import { useChatExtras } from '../runtime/chat-extras';
import { useTranscriptScroll } from './transcript-scroll-context';

import { usePrependAnchor } from './use-prepend-anchor';
import { useDelayedVisible } from '@/lib/use-delayed-visible';
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
  useOlderPageGesture(extras?.loadEarlier, history?.hasMore === true, loading);
  if (!firstId) return null;
  if (scroll?.owned) {
    return (
      <OwnedBoundary
        chatId={extras?.state.chatId}
        loading={loading}
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
 * cue that more is above, the start of the chat, a failed load with Retry), so it never moves the
 * rows under the reader when it changes. While rows of the first window are still mounting above the
 * newest ones, it says nothing: "Beginning of conversation" would sit over rows that are about to land.
 */
function OwnedBoundary({
  chatId,
  loading,
  hasMore,
  error,
  load,
}: {
  chatId: string | undefined;
  loading: boolean;
  hasMore: boolean;
  error: string | undefined;
  load: ((target?: string) => Promise<boolean>) | undefined;
}) {
  const scroll = useTranscriptScroll();
  const tail = scroll?.tailPending;
  const rowsPending = useSyncExternalStore(
    tail?.subscribe ?? NO_SUBSCRIBE,
    tail?.get ?? NOT_PENDING,
    tail?.get ?? NOT_PENDING,
  );
  const held = useDelayedVisible(loading, { delay: 0, minVisible: LOADING_MIN_VISIBLE_MS, resetKey: chatId });
  const box = useRef<HTMLDivElement>(null);
  const retry = () => {
    // The button that was pressed goes away with the state it belongs to: keep focus in the band.
    box.current?.focus({ preventScroll: true });
    void load?.().catch(() => undefined);
  };
  const state = held ? 'loading' : error ? 'error' : hasMore ? 'more' : rowsPending ? 'pending' : 'start';
  return (
    <div
      ref={box}
      tabIndex={-1}
      data-testid="chat-history-boundary"
      data-state={state}
      className="flex h-12 items-center justify-center gap-2 text-xs text-muted-foreground outline-none focus-visible:focus-line"
      aria-live="polite"
      aria-busy={held}
    >
      {state === 'loading' && (
        <>
          <Spinner data-testid="chat-history-spinner" aria-hidden role="presentation" className="size-3.5" />
          <span>Loading earlier messages</span>
        </>
      )}
      {state === 'error' && (
        <>
          <span className="truncate">{error}</span>
          <Button data-testid="chat-load-earlier-retry" variant="ghost" size="sm" onClick={retry}>
            Retry
          </Button>
        </>
      )}
      {state === 'more' && (
        <Button data-testid="chat-load-earlier" variant="ghost" size="sm" onClick={retry}>
          <ArrowUpIcon />
          Earlier messages
        </Button>
      )}
      {state === 'start' && <span>Beginning of conversation</span>}
    </div>
  );
}

const NO_SUBSCRIBE = () => () => undefined;
const NOT_PENDING = () => false;

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
