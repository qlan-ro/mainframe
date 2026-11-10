import { describe, expect, it } from 'vitest';
import type { SessionUpdate } from '@qlan-ro/mainframe-types';
import type { MainframeMessageMeta } from '../message-meta';
import { AcpItemAccumulator } from '../acp-item-accumulator';
import { convertAcpItems } from '../convert-acp-item';

const compaction = {
  origin: 'idle',
  requestId: 'idle-compact:chat:run',
  sessionGeneration: 'session-1',
  commandUuid: 'internal-command',
  vendorId: 'vendor-id',
  beforeTokens: 197000,
  afterTokens: 19000,
} as const;
const frame: SessionUpdate = {
  sessionUpdate: 'agent_message',
  messageId: 'vendor-id',
  content: [],
  _meta: {
    '_mainframe.dev': {
      created: true,
      containerId: 'vendor-id',
      kind: 'system',
      isCompacted: true,
      compaction,
      actionable: false,
    },
  },
};
const timestamp = () => new Date('2026-11-10T00:00:00Z');

function project(replaying: boolean) {
  const accumulator = new AcpItemAccumulator({ strictCreation: true });
  accumulator.setReplaying(replaying);
  accumulator.apply(frame);
  return { items: accumulator.itemsInOrder, messages: convertAcpItems(accumulator.itemsInOrder, timestamp) };
}

describe('idle compaction ACP normalization', () => {
  it('preserves all provenance and counts identically from live and replay-origin items', () => {
    const live = project(false);
    const replay = project(true);
    expect(live.items[0]!.origin).toBe('live');
    expect(replay.items[0]!.origin).toBe('replay');
    expect(replay.messages).toEqual(live.messages);
    expect(live.messages[0]).toMatchObject({
      id: 'vendor-id',
      role: 'system',
      metadata: { custom: { mainframe: { isCompacted: true, compaction, actionable: false } } },
    });
    expect(live.messages[0]!.status).toBeUndefined();
  });

  it('does not fabricate token counts for providers that omit them', () => {
    const withoutCounts = {
      origin: compaction.origin,
      requestId: compaction.requestId,
      sessionGeneration: compaction.sessionGeneration,
      commandUuid: compaction.commandUuid,
      vendorId: compaction.vendorId,
    };
    const accumulator = new AcpItemAccumulator();
    accumulator.apply({
      ...frame,
      _meta: {
        '_mainframe.dev': {
          kind: 'system',
          isCompacted: true,
          compaction: withoutCounts,
          actionable: false,
        },
      },
    });
    const [message] = convertAcpItems(accumulator.itemsInOrder, timestamp);
    expect((message!.metadata?.custom?.mainframe as MainframeMessageMeta | undefined)?.compaction).toEqual(
      withoutCounts,
    );
  });
});
