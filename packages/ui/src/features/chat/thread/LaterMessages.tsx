import { useEffect } from 'react';
import { ArrowDownIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SCROLLBAR_DRAG_EVENT } from '@/lib/overlay-scrollbars/thumb';
import { useChatExtras } from '../runtime/chat-extras';
import { AT_BOTTOM_PX } from './bottom-pin';
import { useTranscriptScroll } from './transcript-scroll-context';

const SCROLL_GESTURES = ['wheel', 'touchmove', 'keydown', SCROLLBAR_DRAG_EVENT];

/**
 * The bottom of a window around a jump target (a Find hit, an Activity row, a link to an item).
 * The window is a snapshot, not the live end: this carries the reader on, with the next items, and
 * at the end of the window back to the live tail. Its height is the same in every state.
 */
export function LaterMessages() {
  const extras = useChatExtras();
  const detached = extras?.state.historyWindow?.detached;
  const load = extras?.loadLater;
  useLaterPageGesture(load, detached?.hasAfter === true, detached?.loadingAfter === true, detached != null);
  if (!detached) return null;
  const state = detached.loadingAfter ? 'loading' : detached.hasAfter ? 'more' : 'end';
  return (
    <div
      data-testid="chat-later-boundary"
      data-state={state}
      className="flex h-12 items-center justify-center gap-2 text-xs text-muted-foreground"
      aria-live="polite"
      aria-busy={detached.loadingAfter}
    >
      {detached.loadingAfter ? (
        <>
          <Spinner data-testid="chat-later-spinner" aria-label="Loading later messages" className="size-3.5" />
          <span>Loading later messages</span>
        </>
      ) : (
        <Button
          data-testid="chat-load-later"
          variant="ghost"
          size="sm"
          onClick={() => {
            void load?.().catch(() => undefined);
          }}
        >
          <ArrowDownIcon />
          {detached.hasAfter ? 'Later messages' : 'Back to latest'}
        </Button>
      )}
    </div>
  );
}

/**
 * Downward reader input near the bottom of the window loads the next items, and at the very bottom of
 * a window that reaches the live end it returns to the tail.
 */
function useLaterPageGesture(
  load: (() => Promise<boolean>) | undefined,
  hasAfter: boolean,
  loading: boolean,
  detached: boolean,
) {
  const scroll = useTranscriptScroll();
  useEffect(() => {
    const viewport = scroll?.viewportElement.current;
    if (!viewport || !detached || loading || !load) return;
    let armed = false;
    const check = () => {
      const left = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      if (!armed || left > (hasAfter ? viewport.clientHeight : AT_BOTTOM_PX)) return;
      armed = false;
      void load().catch(() => undefined);
    };
    const gesture = (event: Event) => {
      if ((event.target as Element).closest('input, textarea, [contenteditable="true"]')) return;
      if (event instanceof KeyboardEvent && !['ArrowDown', 'PageDown', 'End'].includes(event.key)) return;
      if (event instanceof WheelEvent && event.deltaY <= 0) return;
      armed = true;
      check();
    };
    for (const name of SCROLL_GESTURES) viewport.addEventListener(name, gesture, { passive: true });
    viewport.addEventListener('scroll', check, { passive: true });
    return () => {
      for (const name of SCROLL_GESTURES) viewport.removeEventListener(name, gesture);
      viewport.removeEventListener('scroll', check);
    };
  }, [load, hasAfter, loading, detached, scroll]);
}
