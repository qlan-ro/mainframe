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
 *   at the bottom: WebKit delivers a wheel event after its threaded scroll, so a follow write can
 *   land at the bottom between the two and would re-pin a reader who just left,
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
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ACTIVITY_JUMP_EVENT, type ActivityJump } from '@/features/session-panel/activity-source';
import { onUserSent } from '../controller/user-sent';
import { AT_BOTTOM_PX, isAtBottom } from './bottom-pin';
import { HISTORY_PREPEND_EVENT } from './history-prepend-event';
import { anchoringSupported } from './scroll-anchoring';
import { listenForScrollInput } from './scroll-owner-input';
import type { TranscriptScrollController } from './transcript-scroll-context';

const BLOCKS = 'p, pre, table, li, h2, h3, img, [data-message-id], [data-history-item-id]';

/** What the reader is looking at: the block a third of the way down the viewport. */
function readerAnchor(viewport: HTMLElement) {
  const box = viewport.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + viewport.clientHeight / 3);
  const row = hit?.closest<HTMLElement>(BLOCKS);
  return row && viewport.contains(row) ? { row, offset: row.getBoundingClientRect().top - box.top } : null;
}

interface Near {
  row: HTMLElement;
  /** The block's top in the content, which a page above it moves by exactly the page's height. */
  at: number;
  scrollTop: number;
}

export function useScrollOwner(
  threadId: string | null,
  chatId: string | undefined,
  { findOwner = false, away = false }: { findOwner?: boolean; away?: boolean } = {},
) {
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
  const state = useRef({
    following: true,
    movedDown: false,
    lastTop: 0,
    published: true,
    listeners: new Set<() => void>(),
    restore: null as null | ReturnType<typeof readerAnchor>,
    near: null as Near | null,
    /** The frame that clears a record no resize used (a page that changed nothing's height). */
    staleFrame: 0,
    away,
  });
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
    current.movedDown = false;
    const el = viewportElement.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      current.lastTop = el.scrollTop;
    }
    publish();
  }, [publish]);
  const release = useCallback(() => {
    const current = state.current;
    current.following = false;
    current.movedDown = false;
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
    state.current.lastTop = el.scrollTop;
  }, []);
  useLayoutEffect(() => {
    state.current.near = null;
    state.current.restore = null;
    cancelAnimationFrame(state.current.staleFrame);
    pinToBottom();
  }, [threadId, pinToBottom]);
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
    const current = state.current;
    current.lastTop = viewport.scrollTop;
    const onResize = () => {
      if (viewport.clientHeight === 0) return;
      const pending = current.restore;
      current.restore = null;
      const near = current.near;
      current.near = null;
      if (near?.row.isConnected) {
        const moved = near.row.getBoundingClientRect().top - content.getBoundingClientRect().top - near.at;
        // The browser held the reader when scrollTop followed the content; otherwise add what it missed.
        const held = viewport.scrollTop - near.scrollTop > moved / 2;
        if (moved >= 0.5 && !held) viewport.scrollBy({ top: moved, behavior: 'instant' });
      } else if (pending?.row.isConnected && !current.following) {
        viewport.scrollTop +=
          pending.row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - pending.offset;
      }
      if (current.following) viewport.scrollTop = viewport.scrollHeight;
      current.lastTop = viewport.scrollTop;
      publish();
    };
    const onScroll = () => {
      const top = viewport.scrollTop;
      const bottom = viewport.scrollHeight - viewport.clientHeight - top;
      // Up by itself (Find, a jump to a row): not the owner's write, so the reader is no longer at the tail.
      if (current.following && top < current.lastTop - 1 && bottom > AT_BOTTOM_PX) release();
      else if (!current.following && current.movedDown && bottom <= AT_BOTTOM_PX) pinToBottom();
      current.lastTop = top;
      publish();
    };
    // A record is for the commit that follows it: its resize comes in the next frame. Once rows have changed
    // and that frame has passed, a record nobody used belongs to a change that moved nothing; drop it, or a later
    // resize would use it. Tied to the DOM change, not to the clock, so a slow commit keeps its record.
    const staleCheck = () => {
      if (!current.near && !current.restore) return;
      cancelAnimationFrame(current.staleFrame);
      current.staleFrame = requestAnimationFrame(() => {
        current.staleFrame = requestAnimationFrame(() => {
          current.staleFrame = 0;
          current.near = null;
          current.restore = null;
        });
      });
    };
    const mutations = new MutationObserver(staleCheck);
    mutations.observe(content, { childList: true, subtree: true });
    const observer = new ResizeObserver(onResize);
    observer.observe(content);
    observer.observe(viewport);
    viewport.addEventListener('scroll', onScroll, { passive: true });
    const stopInput = listenForScrollInput(viewport, {
      release,
      end: pinToBottom,
      down: () => {
        current.movedDown = true;
        if (isAtBottom(viewport)) pinToBottom();
      },
    });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      viewport.removeEventListener('scroll', onScroll);
      stopInput();
    };
  }, [viewport, content, publish, release, pinToBottom]);
  const subscribePinned = useCallback((listener: () => void) => {
    const { listeners } = state.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const tailPending = useMemo(() => {
    const listeners = new Set<() => void>();
    let pending = false;
    return {
      get: () => pending,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      set: (next: boolean) => {
        if (next === pending) return;
        pending = next;
        listeners.forEach((listener) => listener());
      },
    };
  }, []);
  const isFollowing = useCallback(() => state.current.following, []);
  const isPinned = useCallback(() => state.current.published, []);
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
    }),
    [viewport, isFollowing, beforePrepend, followNow, chatId, findOwner, tailPending],
  );
  return { controller, setViewport, setContent, isPinned, subscribePinned, pinToBottom };
}
