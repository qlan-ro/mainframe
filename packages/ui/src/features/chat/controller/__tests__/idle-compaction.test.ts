import { describe, expect, it, vi } from 'vitest';
import type { MainframeMessageMeta } from '../../view-model/message-meta';
import type { ChatStateEvent } from '../chat-thread-state';
import type { SessionUpdate } from '@qlan-ro/mainframe-types';
import { AcpSessionPlane } from '../acp-session-plane';
import { CHAT_ID, makeFakeAcpClient } from './acp-test-kit';
import { assistantForkPoint } from '../../messages/assistant-fork-point';

const compaction = {
  origin: 'idle',
  requestId: 'idle-compact:chat:run',
  sessionGeneration: 'session-1',
  commandUuid: 'internal-command',
  vendorId: 'vendor-1',
  beforeTokens: 197000,
  afterTokens: 19000,
} as const;
const marker: SessionUpdate = {
  sessionUpdate: 'agent_message',
  messageId: 'stable-idle-marker',
  content: [],
  _meta: {
    '_mainframe.dev': {
      timestamp: '2026-11-10T00:00:00Z',
      containerId: 'stable-idle-marker',
      kind: 'system',
      isCompacted: true,
      compaction,
      actionable: false,
    },
  },
};

async function plane() {
  const dispatch = vi.fn<(event: ChatStateEvent) => void>();
  const client = makeFakeAcpClient();
  const session = new AcpSessionPlane({ getChatId: () => CHAT_ID, dispatch, isDisposed: () => false });
  await session.attach(client);
  dispatch.mockClear();
  return { dispatch, client, session };
}

function lastTranscript(dispatch: ReturnType<typeof vi.fn<(event: ChatStateEvent) => void>>) {
  const events = dispatch.mock.calls.map(([event]) => event);
  const transcripts = events.filter((event) => event.type === 'transcript.updated');
  const last = transcripts[transcripts.length - 1];
  if (last?.type !== 'transcript.updated') throw new Error('Missing transcript');
  return last.messages;
}

describe('idle compaction session projection', () => {
  it('retains stable metadata and system role live and after a full reload without progress/status events', async () => {
    const { dispatch, client, session } = await plane();
    client.emitUpdate(CHAT_ID, {
      sessionUpdate: 'agent_message',
      messageId: 'assistant',
      content: [{ type: 'text', text: 'Done' }],
    });
    dispatch.mockClear();
    client.emitUpdate(CHAT_ID, marker);
    const live = lastTranscript(dispatch);
    expect(live).toHaveLength(2);
    expect((live[0]!.metadata?.custom?.mainframe as MainframeMessageMeta | undefined)?.compaction).toBeUndefined();
    expect(live[1]).toMatchObject({
      id: 'stable-idle-marker',
      role: 'system',
      metadata: { custom: { mainframe: { compaction, actionable: false } } },
    });
    expect(
      assistantForkPoint(
        live.map((message) => ({ id: message.id!, role: message.role })),
        'stable-idle-marker',
      ),
    ).toBeNull();
    expect(dispatch.mock.calls.every(([event]) => event.type === 'transcript.updated')).toBe(true);
    expect(session.userMessageContents()).toEqual([]);
    const reloaded = await plane();
    reloaded.client.emitUpdate(CHAT_ID, marker);
    expect(lastTranscript(reloaded.dispatch)[0]).toEqual(live[1]);
    expect(reloaded.dispatch.mock.calls.every(([event]) => event.type === 'transcript.updated')).toBe(true);
    session.dispose();
    reloaded.session.dispose();
  });

  it('keeps an ordinary compaction separate from idle provenance and accepts real user /compact', async () => {
    const { dispatch, client, session } = await plane();
    client.emitUpdate(CHAT_ID, {
      sessionUpdate: 'agent_message',
      messageId: 'ordinary',
      content: [],
      _meta: { '_mainframe.dev': { kind: 'system', isCompacted: true } },
    });
    client.emitUpdate(CHAT_ID, {
      sessionUpdate: 'user_message',
      messageId: 'manual-command',
      content: [{ type: 'text', text: '/compact' }],
    });
    const messages = lastTranscript(dispatch);
    expect(messages[0]!.metadata?.custom?.mainframe).toEqual({ isCompacted: true });
    expect(messages[1]).toMatchObject({ id: 'manual-command', role: 'user' });
    expect(session.userMessageContents()).toEqual([{ content: [{ type: 'text', text: '/compact' }] }]);
    session.dispose();
  });
});
