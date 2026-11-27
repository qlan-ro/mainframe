// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { getActiveDaemon, setActiveDaemon } from '@/lib/daemon/active-daemon';
import { useHeldQueue } from '../../composer/queue/held-queue-store';
import { forgetSent, heldTimestamp } from '../../composer/queue/sent-order';
import { sendHeldMessages, type ChatActionHost } from '../chat-actions';
import { createChatThreadState } from '../chat-thread-state';

it('records an in-flight held send on its starting daemon and leaves the remaining row held', async () => {
  const original = getActiveDaemon();
  const chatId = 'chat-with-held-messages';
  const timestamp = '2026-11-24T10:00:01.000Z';
  const queuedMessageId = 'queued-on-original';
  const held = useHeldQueue.getState();
  for (const messageId of ['m1', 'm2']) {
    held.hold(chatId, { chatId, messageId, timestamp, uuid: messageId, content: messageId });
  }
  const sendPrompt = vi.fn(async () => {
    setActiveDaemon({ ...original, id: 'switched' });
    return { queued: true, queuedMessageId };
  });
  const host: ChatActionHost = {
    getPort: () => 0,
    getDaemonId: () => chatId,
    getState: () => createChatThreadState(chatId),
    dispatch: vi.fn(),
    load: () => Promise.resolve(),
    sendPrompt,
    announceUserSend: vi.fn(),
  };

  try {
    await sendHeldMessages(host, 'm1');
    expect(heldTimestamp(chatId, queuedMessageId)).toBeUndefined();
    expect(sendPrompt).toHaveBeenCalledOnce();
    setActiveDaemon(original);
    expect(heldTimestamp(chatId, queuedMessageId)).toBe(timestamp);
    expect(useHeldQueue.getState().byChat[chatId]?.map((row) => row.messageId)).toEqual(['m2']);
  } finally {
    forgetSent(chatId);
    setActiveDaemon(original);
    held.clearChat(chatId);
  }
});
