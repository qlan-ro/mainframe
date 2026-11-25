/**
 * useHeldQueuePrune: a client that was offline (or not running) when a project
 * was removed got no `chat.ended` for its chats. On every connect it asks about
 * each chat it holds messages for, and forgets the ones the daemon no longer has.
 */
import { useEffect } from 'react';
import { chatExists } from '@/lib/api/chats';
import { getActiveDaemon } from '@/lib/daemon/active-daemon';
import { useHeldQueue } from '@/features/chat/composer/queue/held-queue-store';
import { daemonWs } from '../../../lib/daemon/ws-client';

async function forgetIfGone(chatId: string, daemon: string): Promise<void> {
  try {
    if ((await chatExists(chatId)) || getActiveDaemon().id !== daemon) return;
    useHeldQueue.getState().clearChat(chatId);
  } catch (error) {
    console.warn('[held-queue] could not check a session with held messages', { chatId, error });
  }
}

function forgetGoneChats(): void {
  if (!daemonWs.connected) return;
  const daemon = getActiveDaemon().id;
  for (const [chatId, rows] of Object.entries(useHeldQueue.getState().byChat)) {
    if (rows.some((row) => row.daemon === daemon)) void forgetIfGone(chatId, daemon);
  }
}

export function useHeldQueuePrune(): void {
  useEffect(() => {
    forgetGoneChats();
    return daemonWs.subscribeConnection(forgetGoneChats);
  }, []);
}
