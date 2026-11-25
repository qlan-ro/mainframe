'use client';

/**
 * useSideChatTab — keeps a chat's side chat and its workspace tab in step while
 * that chat is on screen (the chat column, or a tab of its own).
 *
 * - Opens the tab once, the first time the side chat is seen in this session.
 *   That covers a side chat opened on another client, and the upgrade from the
 *   panel that used to sit beside the thread (`side-chat-tab-store`).
 * - Brings the tab to the front when the side chat starts waiting on the user,
 *   unless the keyboard is already in the workspace: a terminal must not lose
 *   the keys being typed into it. The header toggle and the tab's dot say so
 *   either way.
 * - Closes the tab when the side chat is gone (discarded here or elsewhere).
 * - Keeps the side chat's controller live with the tab closed, so the header
 *   toggle knows whether it runs or waits.
 *
 * The parent's own `sideChatId` is the source of truth. It reaches this client
 * with the next `chat.updated`, after an open that happened here, so a side chat
 * this run registered is never taken for a stale one.
 */
import { useEffect, useRef } from 'react';
import { useChatExtras } from '@/features/chat/runtime/chat-extras';
import { closeChatTab, findChatTab, openChatTab, sessionRun } from '@/features/workspace-chat/conversation-tabs';
import { useKeepAttached } from '@/features/workspace-chat/use-conversation-thread';
import { useLayoutStore } from '@/store/layout';
import { useSessionListLoadState } from '@/features/sessions/runtime/list-load-state';
import { isRegisteredSideChatId } from './side-chat-ids';
import { claimFirstOpen } from './side-chat-tab-store';
import { hasPendingGate, useOptionalControllerState, useSideChatController } from './use-side-chat-controller';

/** Opens a chat's side chat as a tab of `sessionId`'s workspace. */
export function openSideChatTab(sideChatId: string, sessionId?: string | null): void {
  openChatTab({ chatId: sideChatId, role: 'side', title: 'Side chat' }, sessionId ?? undefined);
}

function keyboardInWorkspace(): boolean {
  return document.activeElement?.closest('[data-surface="workspace"]') != null;
}

interface Parent {
  chatId: string | null;
  /** `undefined` until the parent's own config has loaded: nothing to conclude yet. */
  sideChatId: string | null | undefined;
  sessionId: string | null;
}

/** Drops a side chat's tab once the parent no longer has it. */
function useCloseGone({ chatId, sideChatId, sessionId }: Parent): void {
  const onScreen = useLayoutStore((s) => s.activeSessionId === sessionId);
  // Before the list is in, a side chat can be unknown only because its parent has not been read yet.
  const listed = useSessionListLoadState((s) => s.loaded);
  const previous = useRef({ chatId, sideChatId });
  useEffect(() => {
    const before = previous.current;
    if (chatId == null || sideChatId === undefined || !onScreen || !listed) return;
    previous.current = { chatId, sideChatId };
    const lost = before.chatId === chatId && before.sideChatId !== sideChatId ? before.sideChatId : null;
    for (const pane of useLayoutStore.getState().run?.panes ?? []) {
      for (const tab of pane.tabs) {
        if (tab.role !== 'side' || tab.chatId == null || tab.chatId === sideChatId) continue;
        // Unregistered: nothing lists it and nothing opened it this run, so it went while the app was closed.
        if (tab.chatId === lost || !isRegisteredSideChatId(tab.chatId)) closeChatTab(tab.chatId);
      }
    }
  }, [chatId, sideChatId, onScreen, listed]);
}

export function useSideChatTab({
  parentChatId,
  sessionId,
}: {
  parentChatId: string | null;
  /** The session whose workspace the tab belongs to. */
  sessionId: string | null;
}): void {
  const chat = useChatExtras()?.state.chatConfig;
  const loaded = chat != null && chat.id === parentChatId;
  const sideChatId = loaded ? (chat.sideChatId ?? null) : undefined;
  const controller = useSideChatController(sideChatId);
  useKeepAttached(controller);
  useCloseGone({ chatId: parentChatId, sideChatId, sessionId });

  useEffect(() => {
    if (parentChatId == null || sessionId == null || sideChatId == null) return;
    if (findChatTab(sessionRun(sessionId), sideChatId) != null) return;
    if (claimFirstOpen(sessionId, sideChatId, parentChatId)) openSideChatTab(sideChatId, sessionId);
  }, [parentChatId, sessionId, sideChatId]);

  const state = useOptionalControllerState(controller);
  const waiting = state != null && hasPendingGate(state);
  useEffect(() => {
    if (!waiting || sideChatId == null || sessionId == null || keyboardInWorkspace()) return;
    openSideChatTab(sideChatId, sessionId);
  }, [waiting, sideChatId, sessionId]);
}
