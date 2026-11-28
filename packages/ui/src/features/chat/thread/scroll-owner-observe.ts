/**
 * What the scroll owner (`use-scroll-owner.ts`) does on each resize, scroll and reader input of its viewport.
 * Returns the function that stops observing.
 */
import { AT_BOTTOM_PX, isAtBottom } from './bottom-pin';
import { listenForScrollInput } from './scroll-owner-input';
import { layoutExplains, seen, wantsDown, type OwnerState } from './scroll-owner-state';

interface Actions {
  publish: () => void;
  release: () => void;
  pinToBottom: () => void;
}

function resizeHandler(viewport: HTMLElement, content: HTMLElement, current: OwnerState, { publish }: Actions) {
  return () => {
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
    seen(current, viewport);
    publish();
  };
}

function scrollHandler(viewport: HTMLElement, current: OwnerState, { publish, release, pinToBottom }: Actions) {
  return () => {
    const top = viewport.scrollTop;
    const bottom = viewport.scrollHeight - viewport.clientHeight - top;
    if (current.following && top < current.lastTop - 1 && bottom > AT_BOTTOM_PX) {
      // A layout the resize callback has not seen moved it (the browser clamped or anchored the position between
      // frames, #519): the reader is still at the tail. Any other move up (the reader's scroll before its wheel
      // event, a selection drag, Find, a jump to a row) is not the owner's write: the reader left the tail.
      if (layoutExplains(current, viewport, top)) viewport.scrollTop = viewport.scrollHeight;
      else release();
    } else if (!current.following && bottom <= AT_BOTTOM_PX && top > current.lastTop && wantsDown(current)) {
      // Only the reader's own recent downward scroll into the bottom: content shrinking below clamps the position
      // there too, moving it up, and that asks for nothing (#521).
      pinToBottom();
    }
    seen(current, viewport);
    publish();
  };
}

/**
 * A record is for the commit that follows it: its resize comes in the next frame. Once rows have changed and that
 * frame has passed, a record nobody used belongs to a change that moved nothing; drop it, or a later resize would
 * use it. Tied to the DOM change, not to the clock, so a slow commit keeps its record.
 */
function staleHandler(current: OwnerState) {
  return () => {
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
}

export function observeScrollOwner(viewport: HTMLElement, content: HTMLElement, current: OwnerState, actions: Actions) {
  seen(current, viewport);
  const onScroll = scrollHandler(viewport, current, actions);
  const mutations = new MutationObserver(staleHandler(current));
  mutations.observe(content, { childList: true, subtree: true });
  const observer = new ResizeObserver(resizeHandler(viewport, content, current, actions));
  observer.observe(content);
  observer.observe(viewport);
  viewport.addEventListener('scroll', onScroll, { passive: true });
  const stopInput = listenForScrollInput(viewport, {
    release: actions.release,
    end: actions.pinToBottom,
    down: () => {
      current.downAt = performance.now();
      if (isAtBottom(viewport)) actions.pinToBottom();
    },
  });
  return () => {
    observer.disconnect();
    mutations.disconnect();
    viewport.removeEventListener('scroll', onScroll);
    stopInput();
  };
}
