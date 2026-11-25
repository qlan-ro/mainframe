'use client';

/**
 * ⌘. with several composers on screen: the conversation's, and one per chat tab
 * of the workspace. It stops the conversation that last had the focus, while
 * that is on screen, and nothing from any other surface (`conversation-focus`).
 * Before any has had it, it stops the chat column's turn if no other runs.
 */
import { useEffect, type RefObject } from 'react';
import { useShortcutAction } from '@/features/shortcuts/action-store';
import { conversationOf, heldConversation } from '@/lib/conversation-focus';

interface Owner {
  anchor: RefObject<Element | null>;
  stop: () => void;
  /** Its turn runs. */
  running: boolean;
}

const owners = new Set<Owner>();

const isShown = ({ anchor }: Owner) =>
  anchor.current != null && anchor.current.closest('[data-conversation-tab="hidden"], [inert]') == null;

const inColumn = ({ anchor }: Owner) => anchor.current?.closest('[data-conversation-tab]') == null;

function target(): Owner | undefined {
  const all = [...owners];
  const held = heldConversation();
  if (held === null) return undefined;
  if (held !== undefined) return all.find((owner) => isShown(owner) && conversationOf(owner.anchor.current) === held);
  const running = all.filter((owner) => owner.running);
  return running.length === 1 ? running.find((owner) => isShown(owner) && inColumn(owner)) : undefined;
}

/** `anchor` is any element of the composer `stop` belongs to. */
export function useStopShortcut(anchor: RefObject<Element | null>, stop: () => void, running: boolean): void {
  useEffect(() => {
    const owner = { anchor, stop, running };
    owners.add(owner);
    return () => void owners.delete(owner);
  }, [anchor, stop, running]);
  useShortcutAction('chat.stop', () => target()?.stop());
}
