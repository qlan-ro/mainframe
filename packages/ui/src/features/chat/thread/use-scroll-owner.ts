/**
 * The one owner of the transcript's scroll position, for the plain list
 * (Settings › Chat › plain transcript list). Browser scroll anchoring
 * (`overflow-anchor: auto`) keeps the reader's place when rows above them change
 * height or a page lands; this hook only:
 *
 * - positions at the tail before the first paint, and again on a chat switch,
 * - follows the bottom by writing the position inside the resize callback, in the frame
 *   the content grew,
 * - releases follow on reader input that moves up (wheel, touch, scroll keys), on opening a row,
 *   on a jump to a row, and on any scroll that moves up by itself (Find, a programmatic jump),
 * - takes follow back only on the reader's downward input that reaches the bottom, the End key,
 *   the jump button, or the user's own send (`controller/user-sent.ts`). Never on a scroll event
 *   at the bottom by itself: WebKit delivers a wheel event after its threaded scroll, so a follow write can
 *   land at the bottom between the two and would re-pin a reader who just left. Downward input counts only
 *   while it is recent (`DOWN_INTENT_MS`) and only for a scroll that moved down: content that shrinks below
 *   the reader clamps the position to the bottom (a turn folding, a run of reads folding), and that is no
 *   reader asking to follow (#521),
 * - keeps following through a move up that a layout change explains, made before the resize callback saw it:
 *   when something reads layout between React's commit and the frame, the browser clamps or anchors the
 *   position there, and its scroll event arrives before the resize callback. Only a layout change that explains
 *   the move keeps follow: a clamp to the lowest content since the owner last acted, or a move no larger than
 *   the content shrank plus the viewport changed (`layoutExplains`). Any other move up releases (#519),
 * - corrects a page that lands within a viewport of the top (or a slice of the opening window)
 *   where the browser did not hold the reader: the block they read is recorded in content
 *   coordinates before the commit, and after layout whatever shift the browser did not apply is
 *   added with a relative `scrollBy`, which keeps the wheel input in flight (an absolute
 *   `scrollTop` write drops it). Measured in the proof rig (`docs/research/2026-11-26-transcript-list-rig.md`, 9.7),
 * - re-applies a measured anchor once after a page lands on an engine without `overflow-anchor`
 *   or at offset 0,
 * - treats a window around a jump target (`away`) as somewhere other than the tail: follow stays
 *   off in it (its bottom is not the live bottom), it opens at its top, and coming back to the tail
 *   pins to the bottom.
 *
 * `openAt: 'top'` is for a view read from its start (a sub-agent's tab): it opens where the
 * browser puts it and does not follow until the reader scrolls down to the bottom.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ACTIVITY_JUMP_EVENT, type ActivityJump } from '@/features/session-panel/activity-source';
import { onUserSent } from '../controller/user-sent';
import { isAtBottom } from './bottom-pin';
import { HISTORY_PREPEND_EVENT } from './history-prepend-event';
import { anchoringSupported } from './scroll-anchoring';
import { observeScrollOwner } from './scroll-owner-observe';
import { createFlag, createOwnerState, readerAnchor, seen } from './scroll-owner-state';
import type { TranscriptScrollController } from './transcript-scroll-context';

export { DOWN_INTENT_MS } from './scroll-owner-state';

export function useScrollOwner(
  threadId: string | null,
  chatId: string | undefined,
  {
    findOwner = false,
    away = false,
    openAt = 'tail',
  }: { findOwner?: boolean; away?: boolean; openAt?: 'tail' | 'top' } = {},
) {
  const atTail = openAt === 'tail';
  const [viewport, setViewportState] = useState<HTMLDivElement | null>(null);
  const [content, setContentState] = useState<HTMLDivElement | null>(null);
  const viewportElement = useRef<HTMLDivElement | null>(null);
  const contentElement = useRef<HTMLDivElement | null>(null);
  // Set when the element attaches, so layout effects of this component already see it.
  const setViewport = useCallback((element: HTMLDivElement | null) => {
    viewportElement.current = element;
    setViewportState(element);
  }, []);
  const setContent = useCallback((element: HTMLDivElement | null) => {
    contentElement.current = element;
    setContentState(element);
  }, []);
  const state = useRef(createOwnerState(atTail, away));
  const publish = useCallback(() => {
    const current = state.current;
    const el = viewportElement.current;
    const pinned = current.following || (el ? isAtBottom(el) : true);
    if (pinned === current.published) return;
    current.published = pinned;
    current.listeners.forEach((listener) => listener());
  }, []);
  const pinToBottom = useCallback(() => {
    const current = state.current;
    current.following = !current.away;
    current.downAt = 0;
    const el = viewportElement.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      seen(current, el);
    }
    publish();
  }, [publish]);
  const release = useCallback(() => {
    const current = state.current;
    current.following = false;
    current.downAt = 0;
    publish();
  }, [publish]);
  /** Before rows land above the reader (a page, or a slice of the opening window). */
  const beforePrepend = useCallback(() => {
    const current = state.current;
    const el = viewportElement.current;
    const contentEl = contentElement.current;
    if (!el || current.following) return;
    // A drop scheduled for an earlier record (a slice's) must not clear this one's.
    cancelAnimationFrame(current.staleFrame);
    current.staleFrame = 0;
    current.near = null;
    current.restore = null;
    const hit = readerAnchor(el);
    if (!hit) return;
    if (contentEl && el.scrollTop < el.clientHeight) {
      current.near = {
        row: hit.row,
        at: hit.row.getBoundingClientRect().top - contentEl.getBoundingClientRect().top,
        scrollTop: el.scrollTop,
      };
    } else if (!anchoringSupported()) current.restore = hit;
  }, []);
  /** Keeps the owner at the tail from a layout effect, for rows that land before the resize observer exists. */
  const followNow = useCallback(() => {
    const el = viewportElement.current;
    if (!el || !state.current.following) return;
    el.scrollTop = el.scrollHeight;
    seen(state.current, el);
  }, []);
  useLayoutEffect(() => {
    state.current.near = null;
    state.current.restore = null;
    cancelAnimationFrame(state.current.staleFrame);
    if (atTail) pinToBottom();
  }, [threadId, pinToBottom, atTail]);
  const wasAway = useRef(away);
  useLayoutEffect(() => {
    state.current.away = away;
    if (wasAway.current === away) return;
    wasAway.current = away;
    const current = state.current;
    current.near = null;
    current.restore = null;
    cancelAnimationFrame(current.staleFrame);
    if (!away) {
      pinToBottom();
      return;
    }
    // The rows are another window: the old position means nothing in it. The jump that asked for it scrolls on.
    release();
    const el = viewportElement.current;
    if (el) {
      el.scrollTop = 0;
      current.lastTop = 0;
    }
  }, [away, pinToBottom, release]);
  useEffect(() => (threadId == null ? undefined : onUserSent(threadId, pinToBottom)), [threadId, pinToBottom]);
  useEffect(() => () => cancelAnimationFrame(state.current.staleFrame), []);
  useEffect(() => {
    const jump = (event: Event) => {
      if ((event as CustomEvent<ActivityJump>).detail.chatId === chatId) release();
    };
    const prepend = (event: Event) => {
      if ((event as CustomEvent<string>).detail === chatId) beforePrepend();
    };
    window.addEventListener(ACTIVITY_JUMP_EVENT, jump);
    window.addEventListener(HISTORY_PREPEND_EVENT, prepend);
    return () => {
      window.removeEventListener(ACTIVITY_JUMP_EVENT, jump);
      window.removeEventListener(HISTORY_PREPEND_EVENT, prepend);
    };
  }, [chatId, release, beforePrepend]);
  useEffect(() => {
    if (!viewport || !content) return;
    return observeScrollOwner(viewport, content, state.current, { publish, release, pinToBottom });
  }, [viewport, content, publish, release, pinToBottom]);
  const subscribePinned = useCallback((listener: () => void) => {
    const { listeners } = state.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const tailPending = useMemo(() => createFlag(), []);
  const isFollowing = useCallback(() => state.current.following, []);
  const isPinned = useCallback(() => state.current.published, []);
  const pinned = useMemo(() => ({ get: isPinned, subscribe: subscribePinned }), [isPinned, subscribePinned]);
  const controller: TranscriptScrollController = useMemo(
    () => ({
      owned: true,
      viewport,
      viewportElement,
      isFollowing,
      isInteracting: () => false,
      beginInteraction: () => () => undefined,
      beforePrepend,
      followNow,
      chatId,
      findOwner,
      tailPending,
      pinned,
    }),
    [viewport, isFollowing, beforePrepend, followNow, chatId, findOwner, tailPending, pinned],
  );
  return { controller, setViewport, setContent, isPinned, subscribePinned, pinToBottom };
}
