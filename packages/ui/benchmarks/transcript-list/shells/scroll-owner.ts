/**
 * v1's one scroll owner, the design #461 would ship: the browser's scroll
 * anchoring (`overflow-anchor: auto`) holds the reader's place for pages and
 * resizes above; this module only
 *
 * - positions at the tail before the first paint,
 * - follows the bottom, writing the position inside the resize callback (same frame),
 * - releases follow on reader input that moves up (wheel up, touch, scroll keys, scrollbar),
 *   and takes it back when the reader's own downward input (wheel down, scroll keys,
 *   scrollbar) reaches the bottom, or on the jump. Not on any scroll event at the bottom:
 *   WebKit delivers a wheel event after its threaded scroll, so a follow write can land
 *   at the bottom between the two and would re-pin the reader who just left,
 * - re-applies a measured anchor (the block the reader is looking at) once after a
 *   page lands where the browser does not anchor reliably: at scroll offset 0, where
 *   its anchor node is the first rows, which a page that completes a cut turn
 *   regroups; and on engines without `overflow-anchor`,
 * - near the top (within a viewport), corrects what the browser did not hold with a relative
 *   `scrollBy` after layout (`?near=1`). The measured restore reads a main-thread `scrollTop` that
 *   momentum has already moved past; the correction is measured in content coordinates and keeps the
 *   wheel input in flight, which an absolute write drops.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { params } from '../params';

const PREPEND_EVENT = 'mainframe:history-prepend';
const UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home']);
const anchoring = typeof CSS !== 'undefined' && CSS.supports('overflow-anchor', 'auto');

const gap = (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop;

/** What the reader is looking at: the block a third of the way down the viewport. */
function readerAnchor(viewport: HTMLElement) {
  const box = viewport.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + viewport.clientHeight / 3);
  const row = hit?.closest<HTMLElement>('p, pre, table, li, h2, h3, img, [data-message-id]');
  return row && viewport.contains(row) ? { row, offset: row.getBoundingClientRect().top - box.top } : null;
}

const DOWN_KEYS = new Set(['ArrowDown', 'PageDown', ' ']);

function listenForInput(viewport: HTMLElement, release: () => void, jump: () => void, down: () => void) {
  const wheel = (event: WheelEvent) => (event.deltaY < 0 ? release() : event.deltaY > 0 && down());
  const key = (event: KeyboardEvent) => {
    if ((event.target as Element).closest('input, textarea, [contenteditable="true"]')) return;
    if (event.key === 'End') jump();
    else if (UP_KEYS.has(event.key) || (event.key === ' ' && event.shiftKey)) release();
    else if (DOWN_KEYS.has(event.key)) down();
  };
  const pointer = (event: PointerEvent) => {
    if (event.offsetX <= viewport.clientWidth) return;
    release();
    down();
  };
  viewport.addEventListener('wheel', wheel, { passive: true });
  viewport.addEventListener('touchmove', release, { passive: true });
  viewport.addEventListener('keydown', key);
  viewport.addEventListener('pointerdown', pointer);
  return () => {
    viewport.removeEventListener('wheel', wheel);
    viewport.removeEventListener('touchmove', release);
    viewport.removeEventListener('keydown', key);
    viewport.removeEventListener('pointerdown', pointer);
  };
}

export function useScrollOwner() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const state = useRef({
    following: true,
    movedDown: false,
    restore: null as null | ReturnType<typeof readerAnchor>,
    shift: null as null | { row: HTMLElement; at: number; until: number },
    near: null as null | { row: HTMLElement; at: number; scrollTop: number },
  });
  const jump = useCallback(() => {
    const viewport = viewportRef.current;
    state.current.following = true;
    state.current.movedDown = false;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, []);
  useLayoutEffect(jump, [jump]);
  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const current = state.current;
    const onResize = () => {
      const pending = current.restore;
      current.restore = null;
      const shifting = current.shift;
      const near = current.near;
      if (near) {
        current.near = null;
        if (near.row.isConnected) {
          const moved = near.row.getBoundingClientRect().top - content.getBoundingClientRect().top - near.at;
          // Anchoring held when scrollTop followed the content; otherwise add the shift relatively.
          const held = viewport.scrollTop - near.scrollTop > moved / 2;
          if (!held) viewport.scrollBy({ top: moved, behavior: 'instant' });
        }
      }
      if (shifting) {
        const moved = shifting.row.isConnected
          ? shifting.row.getBoundingClientRect().top - content.getBoundingClientRect().top - shifting.at
          : 0;
        if (Math.abs(moved) >= 0.5 || performance.now() > shifting.until || !shifting.row.isConnected) {
          if (!current.following && shifting.row.isConnected) viewport.scrollTop += moved;
          viewport.style.overflowAnchor = '';
          current.shift = null;
        }
      }
      if (current.following) viewport.scrollTop = viewport.scrollHeight;
      else if (pending?.row.isConnected)
        viewport.scrollTop +=
          pending.row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - pending.offset;
    };
    const beforePrepend = () => {
      // FIX (short window): the browser does not hold the reader when a page lands while the reader is
      // at or near offset 0 and still moving (WebKit's momentum). Take over for this landing: switch the
      // browser's anchoring off, remember where the reader's block sits in the content, and after
      // layout move scrollTop by exactly how far that block moved. The shift is measured in content
      // coordinates, so scroll the reader did meanwhile is kept, unlike a restore of a viewport offset.
      if (params.fixOwner === 1 && !current.following) {
        const hit = readerAnchor(viewport);
        if (hit) {
          current.shift = {
            row: hit.row,
            at: hit.row.getBoundingClientRect().top - content.getBoundingClientRect().top,
            until: performance.now() + 1000,
          };
          viewport.style.overflowAnchor = 'none';
        }
        return;
      }
      // Near the top the browser may not anchor (WebKit's momentum, a main-thread offset behind the
      // scrolling thread's): record the reader's block in content coordinates, leave anchoring on, and
      // after layout add whatever shift it did not apply with a relative `scrollBy`, which keeps the wheel
      // input in flight (an absolute `scrollTop` write drops it).
      if (params.nearFix && !current.following && viewport.scrollTop < viewport.clientHeight) {
        const hit = readerAnchor(viewport);
        if (hit) {
          current.near = {
            row: hit.row,
            at: hit.row.getBoundingClientRect().top - content.getBoundingClientRect().top,
            scrollTop: viewport.scrollTop,
          };
          return;
        }
      }
      if (!current.following && (!anchoring || viewport.scrollTop < 1)) current.restore = readerAnchor(viewport);
    };
    const onScroll = () => {
      if (!current.following && current.movedDown && gap(viewport) <= 1) current.following = true;
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(content);
    observer.observe(viewport);
    window.addEventListener(PREPEND_EVENT, beforePrepend);
    viewport.addEventListener('scroll', onScroll, { passive: true });
    const release = () => {
      current.following = false;
      current.movedDown = false;
    };
    const stopInput = listenForInput(viewport, release, jump, () => (current.movedDown = true));
    return () => {
      observer.disconnect();
      window.removeEventListener(PREPEND_EVENT, beforePrepend);
      viewport.removeEventListener('scroll', onScroll);
      stopInput();
    };
  }, [jump]);
  return { viewportRef, contentRef, jump, isFollowing: () => state.current.following };
}
