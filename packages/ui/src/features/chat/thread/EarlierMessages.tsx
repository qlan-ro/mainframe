import { useEffect } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { useChatExtras } from '../runtime/chat-extras';
import { useTranscriptScroll } from './transcript-scroll-context';

import { usePrependAnchor } from './use-prepend-anchor';
export { HISTORY_PREPEND_EVENT } from './use-prepend-anchor';

export function EarlierMessages() {
  const extras = useChatExtras();
  const firstId = useAuiState((s) => s.thread.messages[0]?.id);
  const history = extras?.state.historyWindow;
  const anchoring = usePrependAnchor(firstId, extras?.state.chatId, history?.floorItemId);
  const loading = history?.loading === true || anchoring;
  useOlderPageGesture(extras?.loadEarlier, history?.hasMore === true, loading);
  if (!firstId) return null;
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
      if (event.type === 'pointerdown') {
        const pointer = event as PointerEvent;
        const box = viewport.getBoundingClientRect();
        if (
          event.target !== viewport ||
          viewport.offsetWidth <= viewport.clientWidth ||
          pointer.clientX < box.left + viewport.clientWidth
        )
          return;
      }
      armed = true;
      check();
    };
    for (const name of ['wheel', 'touchmove', 'keydown', 'pointerdown'])
      viewport.addEventListener(name, gesture, { passive: true });
    viewport.addEventListener('scroll', check, { passive: true });
    return () => {
      for (const name of ['wheel', 'touchmove', 'keydown', 'pointerdown']) viewport.removeEventListener(name, gesture);
      viewport.removeEventListener('scroll', check);
    };
  }, [load, hasMore, loading, scroll]);
}
