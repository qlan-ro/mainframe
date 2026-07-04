import { describe, it, expect, vi } from 'vitest';
import { EventHandler } from '../event-handler.js';
import { MessageCache } from '../message-cache.js';
import { PermissionManager } from '../permission-manager.js';
import type { ChatMessage, DaemonEvent, QueuedMessageRef, SessionResult } from '@qlan-ro/mainframe-types';

const umsg = (id: string, meta?: Record<string, unknown>): ChatMessage => ({
  id,
  chatId: 'c1',
  type: 'user',
  content: [{ type: 'text', text: id }],
  timestamp: new Date().toISOString(),
  ...(meta ? { metadata: meta } : {}),
});

function makeHandler(messages: MessageCache, refs: QueuedMessageRef[], events: DaemonEvent[]) {
  const db: any = { chats: { update: vi.fn(), get: vi.fn() }, projects: { get: vi.fn() }, settings: { get: vi.fn() } };
  const active = {
    chat: { id: 'c1', totalCost: 0, totalTokensInput: 0, totalTokensOutput: 0, processState: 'working' },
    session: { id: 's1', adapterId: 'claude' },
  };
  const handler = new EventHandler(
    db,
    messages,
    new PermissionManager(),
    () => active as never,
    (e) => events.push(e),
    () => undefined,
    (_c: string, uuid: string) => {
      const i = refs.findIndex((r) => r.uuid === uuid);
      if (i >= 0) refs.splice(i, 1);
    }, // onQueuedProcessedCb deletes the ref
    () => {},
    () => refs, // reads the MUTABLE array — orphan pruning is observable
  );
  return { handler, active };
}

describe('move-on-process — ack path', () => {
  it('moves the acked message to the end, strips its queued metadata, and deletes the ref', () => {
    const events: DaemonEvent[] = [];
    const messages = new MessageCache();
    messages.append('c1', umsg('q', { queued: true, uuid: 'u1' }));
    messages.append('c1', umsg('assistant-reply'));
    const refs: QueuedMessageRef[] = [{ uuid: 'u1', chatId: 'c1', messageId: 'q', content: 'q', timestamp: '' }];
    const { handler } = makeHandler(messages, refs, events);
    const sink = handler.buildSink('c1', vi.fn().mockResolvedValue(undefined));

    sink.onQueuedProcessed?.('u1');

    expect(messages.get('c1')!.map((m) => m.id)).toEqual(['assistant-reply', 'q']);
    const moved = messages.get('c1')!.find((m) => m.id === 'q')!;
    expect(moved.metadata?.queued).toBeUndefined();
    expect(moved.metadata?.uuid).toBeUndefined();
    expect(refs).toHaveLength(0);
    expect(events.some((e) => e.type === 'message.queued.processed' && (e as any).uuid === 'u1')).toBe(true);
  });
});

describe('move-on-process — onResult orphan-reconcile path', () => {
  it('moves an orphan queued message (flag present, no matching ref) to the end and goes idle', () => {
    const events: DaemonEvent[] = [];
    const messages = new MessageCache();
    messages.append('c1', umsg('q', { queued: true, uuid: 'u1' })); // flagged, but…
    messages.append('c1', umsg('assistant-reply'));
    const refs: QueuedMessageRef[] = []; // …no ref → orphan flag → reconcile strips + moves
    const { handler, active } = makeHandler(messages, refs, events);
    const sink = handler.buildSink('c1', vi.fn().mockResolvedValue(undefined));

    sink.onResult?.({ total_cost_usd: 0, subtype: 'success', is_error: false } as SessionResult);

    expect(messages.get('c1')!.map((m) => m.id)).toEqual(['assistant-reply', 'q']);
    expect(messages.get('c1')!.find((m) => m.id === 'q')!.metadata?.queued).toBeUndefined();
    expect(active.chat.processState).toBe('idle'); // no refs remain
  });
});
