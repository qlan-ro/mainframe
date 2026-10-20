import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranscriptScroll } from './transcript-scroll-context';
import { ACTIVITY_JUMP_EVENT } from '@/features/session-panel/activity-source';

export const HISTORY_PREPEND_EVENT = 'mainframe:history-prepend';

function captureRestore(viewport: HTMLElement, pinned: boolean, chatId: string | undefined, virtual: boolean) {
  const top = viewport.getBoundingClientRect().top;
  const anchor = [...viewport.querySelectorAll<HTMLElement>('[data-message-id]')].find(
    (node) => node.getBoundingClientRect().bottom > top,
  );
  const offset = anchor?.getBoundingClientRect().top;
  const anchorId = anchor?.dataset.messageId;
  const height = viewport.scrollHeight;
  const oldTop = viewport.scrollTop;
  return () => {
    if (viewport.dataset.mfChatId && viewport.dataset.mfChatId !== chatId) return;
    const current = anchor?.isConnected
      ? anchor
      : [...viewport.querySelectorAll<HTMLElement>('[data-message-id]')].find(
          (node) => node.dataset.messageId === anchorId,
        );
    if (pinned) viewport.scrollTop = viewport.scrollHeight;
    else if (current && offset !== undefined) viewport.scrollTop += current.getBoundingClientRect().top - offset;
    else if (!virtual) viewport.scrollTop = oldTop + viewport.scrollHeight - height;
  };
}

function settleVirtual(viewport: HTMLElement, restore: () => void, release: () => void, pinned: boolean) {
  let revision = 0;
  const changed = () => {
    const top = viewport.scrollTop;
    restore();
    if (!pinned && Math.abs(viewport.scrollTop - top) > 0.5) revision++;
  };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(changed);
  const mutations = new MutationObserver(changed);
  const content = viewport.querySelector('[data-testid="chat-message-list"]');
  if (content) {
    observer?.observe(content);
    mutations.observe(content, { childList: true, subtree: true });
  }
  let frame = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    observer?.disconnect();
    mutations.disconnect();
    cancelAnimationFrame(frame);
    release();
  };
  restore();
  let lastRevision = -1;
  let stable = 0;
  const tick = () => {
    changed();
    stable = revision === lastRevision ? stable + 1 : 0;
    lastRevision = revision;
    if (stable >= 4) finish();
    else frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return finish;
}

function prepareRestore(viewport: HTMLElement, pinned: boolean, chatId: string | undefined, release: () => void) {
  const virtual = Boolean(viewport.querySelector('[data-virtualized="true"]'));
  const restore = captureRestore(viewport, pinned, chatId, virtual);
  return {
    cancel: release,
    apply: () => {
      if (virtual) return settleVirtual(viewport, restore, release, pinned);
      restore();
      release();
    },
  };
}

export function usePrependAnchor(firstId: string | undefined, chatId: string | undefined) {
  const scroll = useTranscriptScroll();
  const [anchoring, setAnchoring] = useState(false);
  const pending = useRef<null | { apply: () => (() => void) | undefined; cancel: () => void }>(null);
  const settling = useRef<null | (() => void)>(null);
  useEffect(() => {
    const beforePrepend = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== chatId) return;
      const viewport = scroll?.viewportElement.current;
      if (!viewport) return;
      settling.current?.();
      const pinned = scroll.isFollowing();
      const unlock = scroll.beginInteraction();
      setAnchoring(true);
      const release = () => {
        unlock();
        setAnchoring(false);
      };
      pending.current = prepareRestore(viewport, pinned, chatId, release);
    };
    const cancel = (event?: Event) => {
      if (event && (event as CustomEvent<{ chatId: string }>).detail.chatId !== chatId) return;
      pending.current?.cancel();
      pending.current = null;
      settling.current?.();
      settling.current = null;
    };
    window.addEventListener(HISTORY_PREPEND_EVENT, beforePrepend);
    window.addEventListener(ACTIVITY_JUMP_EVENT, cancel);
    return () => {
      window.removeEventListener(HISTORY_PREPEND_EVENT, beforePrepend);
      window.removeEventListener(ACTIVITY_JUMP_EVENT, cancel);
      cancel();
    };
  }, [chatId, scroll]);
  useLayoutEffect(() => {
    settling.current?.();
    settling.current = pending.current?.apply() ?? null;
    pending.current = null;
  }, [firstId]);
  return anchoring;
}
