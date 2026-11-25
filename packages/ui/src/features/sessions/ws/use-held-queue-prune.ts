/**
 * useHeldQueuePrune: a client that was offline (or not running) when a project
 * was removed got no `chat.ended` for its chats. On every connect it asks about
 * each chat it holds messages for, and forgets the ones the daemon no longer has.
 */
import { useEffect } from 'react';
import { getChat } from '@/lib/api/chats';
import { getActiveDaemon } from '@/lib/daemon/active-daemon';
import { useHeldQueue } from '@/features/chat/composer/queue/held-queue-store';
import { daemonWs } from '../../../lib/daemon/ws-client';

/** Only the daemon's own "no such chat" counts; unreachable or failing, it has said nothing. */
const isGone = (error: unknown): boolean => (error as { status?: unknown } | null | undefined)?.status === 404;

async function forgetIfGone(port: number, chatId: string, daemon: string): Promise<void> {
  try {
    await getChat(port, chatId);
  } catch (error) {
    if (!isGone(error)) {
      console.warn('[held-queue] could not check a session with held messages', { chatId, error });
      return;
    }
    if (getActiveDaemon().id === daemon) useHeldQueue.getState().clearChat(chatId);
  }
}

function forgetGoneChats(port: number): void {
  const daemon = getActiveDaemon().id;
  for (const [chatId, rows] of Object.entries(useHeldQueue.getState().byChat)) {
    if (rows.some((row) => row.daemon === daemon)) void forgetIfGone(port, chatId, daemon);
  }
}

export function useHeldQueuePrune(port: number): void {
  useEffect(() => {
    const prune = () => {
      if (daemonWs.connected) forgetGoneChats(port);
    };
    prune();
    return daemonWs.subscribeConnection(prune);
  }, [port]);
}
