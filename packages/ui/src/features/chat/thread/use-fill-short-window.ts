import { useEffect, useRef } from 'react';
import { useTranscriptScroll } from './transcript-scroll-context';

/** A transcript shorter than this many viewport heights asks for an older page by itself. */
export const FILL_VIEWPORTS = 2.5;
/** Automatic pages in a row before the fill stops and leaves the rest to the gesture. */
export const FILL_MAX_PAGES = 3;
/** Frames the content height must hold still before it counts as measured (the opening). */
const SETTLE_FRAMES = 3;

/**
 * Fill on open: the daemon's first window is a count of display containers, so
 * a tool-heavy chat can open far shorter than the screen, and the reader's first
 * upward scroll would then load a page while already at offset 0. While the
 * reader is at the bottom and the content is short, this loads older pages until
 * it is about 2.5 viewports tall, the chat's start is reached, or the cap holds.
 * Pages land through the usual prepend lock, which keeps a pinned reader at the
 * bottom. It never runs once the reader has left the bottom, or during a prepend
 * or fold that holds the lock. A user-requested page resets the count.
 *
 * It reads only the scroll controller (`isFollowing`, `isInteracting`), so it
 * works with any list that provides it.
 */
export function useFillShortWindow(
  chatId: string | undefined,
  load: ((target?: string) => Promise<boolean>) | undefined,
  hasMore: boolean,
  busy: boolean,
  landed: string | undefined,
) {
  const scroll = useTranscriptScroll();
  const run = useRef({
    chatId,
    pages: 0,
    auto: false,
    landed: undefined as string | undefined,
    attempted: undefined as string | undefined,
  });
  useEffect(() => {
    if (run.current.chatId !== chatId)
      run.current = { chatId, pages: 0, auto: false, landed: undefined, attempted: undefined };
    const state = run.current;
    if (busy) return;
    // A page that landed on the fill's own request counts toward the cap; any other resets it.
    if (landed !== state.landed) {
      if (!state.auto) state.pages = 0;
      state.auto = false;
      state.landed = landed;
    }
    const viewport = scroll?.viewportElement.current;
    if (!viewport || !load || !hasMore || landed === undefined) return;
    if (state.pages >= FILL_MAX_PAGES || state.attempted === landed) return;
    let frame = 0;
    let stable = 0;
    let lastHeight = -1;
    const check = () => {
      if (!scroll || !viewport.isConnected || !viewport.clientHeight) return;
      if (!scroll.isFollowing() || scroll.isInteracting?.()) return;
      if (viewport.scrollHeight >= FILL_VIEWPORTS * viewport.clientHeight) return;
      state.attempted = landed;
      state.auto = true;
      state.pages++;
      void load().then(
        (loaded) => {
          if (!loaded) state.auto = false;
        },
        () => {
          state.auto = false;
        },
      );
    };
    const tick = () => {
      stable = viewport.scrollHeight === lastHeight ? stable + 1 : 0;
      lastHeight = viewport.scrollHeight;
      if (stable >= SETTLE_FRAMES) check();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [scroll, load, hasMore, busy, landed, chatId]);
}
