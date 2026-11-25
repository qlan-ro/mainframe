'use client';

/**
 * ⌘. with several composers on screen: the conversation's, and one per chat tab
 * of the workspace. It stops the conversation that has the keyboard, the chat
 * column's when that is none of them. An agent tab has no composer, so there it
 * stops nothing.
 */
import { useEffect, type RefObject } from 'react';
import { useShortcutAction } from '@/features/shortcuts/action-store';

interface Owner {
  anchor: RefObject<Element | null>;
  stop: () => void;
}

const TAB = '[data-conversation-tab]';
const owners = new Set<Owner>();

function stopConversationWithKeyboard(): void {
  const tab = document.activeElement?.closest(TAB) ?? null;
  for (const { anchor, stop } of owners) {
    if (anchor.current && anchor.current.closest(TAB) === tab) return stop();
  }
}

/** `anchor` is any element of the composer `stop` belongs to. */
export function useStopShortcut(anchor: RefObject<Element | null>, stop: () => void): void {
  useEffect(() => {
    const owner = { anchor, stop };
    owners.add(owner);
    return () => void owners.delete(owner);
  }, [anchor, stop]);
  useShortcutAction('chat.stop', stopConversationWithKeyboard);
}
