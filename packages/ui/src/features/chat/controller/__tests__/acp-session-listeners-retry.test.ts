/**
 * `wireAcpSessionListeners` — reconnect status plumbing (todo #406). A retry
 * signal reaches the reducer with no content upsert following, and the first
 * content for the turn clears it before the update is forwarded.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SessionUpdate } from '@qlan-ro/mainframe-types';
import { wireAcpSessionListeners } from '../acp-session-listeners';
import type { AcpSessionAttachmentHost, AcpSessionClientPort } from '../acp-session-attachment-types';
import type { ChatStateEvent } from '../chat-thread-state';

type RetryListener = (sessionId: string, status: { attempt: number; maxAttempts?: number }) => void;
type UpdateListener = (sessionId: string, update: SessionUpdate) => void;

function setup() {
  const log: Array<ChatStateEvent | { forwarded: SessionUpdate }> = [];
  let retry: RetryListener = () => {};
  let update: UpdateListener = () => {};
  const none = () => () => {};
  const client = {
    onSessionUpdate: (l: UpdateListener) => ((update = l), () => {}),
    onRetryStatus: (l: RetryListener) => ((retry = l), () => {}),
    onPermissionRequest: none,
    onGateResolved: none,
    onCompaction: none,
    onTranscriptCleared: none,
    onQueueState: none,
    onResync: none,
  } as unknown as AcpSessionClientPort;
  const host = {
    dispatch: (event: ChatStateEvent) => void log.push(event),
    onSessionUpdate: (u: SessionUpdate) => void log.push({ forwarded: u }),
  } as unknown as AcpSessionAttachmentHost;
  wireAcpSessionListeners(client, {
    getChatId: () => 'chat-1',
    host,
    fullReplay: {} as never,
    replay: {} as never,
    syncConnectionGeneration: vi.fn(),
    isResumeOrReplayPending: () => false,
  });
  return {
    log,
    retry: (...args: Parameters<RetryListener>) => retry(...args),
    update: (u: SessionUpdate) => update('chat-1', u),
  };
}

describe('wireAcpSessionListeners — retry status', () => {
  it('dispatches the status with no content update following', () => {
    const { log, retry } = setup();
    retry('chat-1', { attempt: 2, maxAttempts: 5 });
    expect(log).toEqual([{ type: 'retry.status', attempt: 2, maxAttempts: 5 }]);
  });

  it('omits the maximum when unknown and ignores another chat', () => {
    const { log, retry } = setup();
    retry('chat-1', { attempt: 3 });
    retry('other', { attempt: 1, maxAttempts: 5 });
    expect(log).toEqual([{ type: 'retry.status', attempt: 3, maxAttempts: undefined }]);
  });

  it('clears before forwarding the first content update', () => {
    const { log, update } = setup();
    const chunk = {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm',
      content: { type: 'text', text: 'x' },
    } as SessionUpdate;
    update(chunk);
    expect(log).toEqual([{ type: 'retry.cleared' }, { forwarded: chunk }]);
  });

  it('forwards without clearing for an overlay-removal upsert', () => {
    const { log, update } = setup();
    const removal = { sessionUpdate: 'agent_message', messageId: 'm', content: [] } as SessionUpdate;
    update(removal);
    expect(log).toEqual([{ forwarded: removal }]);
  });
});
