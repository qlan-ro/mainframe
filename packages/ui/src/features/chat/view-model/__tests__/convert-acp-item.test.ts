import { describe, expect, it } from 'vitest';
import type { AccumulatedItem } from '../acp-item-accumulator';
import { convertAcpItem, convertAcpItems } from '../convert-acp-item';

const createdAt = new Date('2026-08-28T00:00:00.000Z');

describe('convertAcpItem — message/thought/tool-call kinds', () => {
  it('a user message item becomes a user text message', () => {
    const item: AccumulatedItem = { kind: 'message', id: 'u1', role: 'user', text: 'hello' };
    expect(convertAcpItem(item, createdAt)).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      id: 'u1',
      createdAt,
    });
  });

  it('an agent message item becomes an assistant text message', () => {
    const item: AccumulatedItem = { kind: 'message', id: 'a1', role: 'agent', text: 'answer' };
    expect(convertAcpItem(item, createdAt)).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'answer' }],
      id: 'a1',
      createdAt,
    });
  });

  it('a thought item becomes an assistant message with a reasoning part', () => {
    const item: AccumulatedItem = { kind: 'thought', id: 'a1-thought', text: 'reasoning' };
    expect(convertAcpItem(item, createdAt)).toEqual({
      role: 'assistant',
      content: [{ type: 'reasoning', text: 'reasoning' }],
      id: 'a1-thought',
      createdAt,
    });
  });

  it('an empty message text still yields one content part (ensureNonEmpty)', () => {
    const item: AccumulatedItem = { kind: 'message', id: 'a1', role: 'agent', text: '' };
    expect(convertAcpItem(item, createdAt).content).toEqual([{ type: 'text', text: '' }]);
  });

  it('a tool-call item becomes an assistant message with a tool-call part', () => {
    const item: AccumulatedItem = {
      kind: 'tool-call',
      id: 't1',
      title: 'Read package.json',
      toolKind: 'read',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: '{"name":"mainframe"}' } }],
      rawInput: { file_path: '/repo/package.json' },
    };
    expect(convertAcpItem(item, createdAt)).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'Read package.json',
          args: { file_path: '/repo/package.json' },
          result: '{"name":"mainframe"}',
          isError: false,
        },
      ],
      id: 't1',
      createdAt,
    });
  });

  it('a failed tool call sets isError, and a pending one (no content) has no result', () => {
    const item: AccumulatedItem = { kind: 'tool-call', id: 't1', status: 'failed', content: [] };
    const converted = convertAcpItem(item, createdAt);
    expect(converted.content).toEqual([
      { type: 'tool-call', toolCallId: 't1', toolName: 't1', args: {}, result: undefined, isError: true },
    ]);
  });
});

describe('convertAcpItem — subagent attribution via _meta, not task_group nesting', () => {
  it('carries parentToolCallId into metadata.custom.mainframe for a flattened subagent tool call', () => {
    const item: AccumulatedItem = {
      kind: 'tool-call',
      id: 'sub-1',
      title: 'Grep for TODO',
      content: [],
      meta: { '_mainframe.dev': { parentToolCallId: 'agent-1' } },
    };
    const converted = convertAcpItem(item, createdAt);
    expect(converted.metadata).toEqual({ custom: { mainframe: { parentToolCallId: 'agent-1' } } });
  });

  it('omits metadata entirely when there is no parent relation', () => {
    const item: AccumulatedItem = { kind: 'tool-call', id: 't1', content: [] };
    expect(convertAcpItem(item, createdAt).metadata).toBeUndefined();
  });
});

describe('convertAcpItem — patch-revised items convert identically to a directly-created equivalent', () => {
  it('a revised message (content replaced wholesale) converts the same as if it had arrived whole', () => {
    const revised: AccumulatedItem = { kind: 'message', id: 'm1', role: 'agent', text: 'final text' };
    const direct: AccumulatedItem = { kind: 'message', id: 'm1', role: 'agent', text: 'final text' };
    expect(convertAcpItem(revised, createdAt)).toEqual(convertAcpItem(direct, createdAt));
  });

  it('a patched tool call (status advanced, title unchanged) keeps stable ids across the revision', () => {
    const created: AccumulatedItem = { kind: 'tool-call', id: 't1', title: 'Bash', status: 'pending', content: [] };
    const patched: AccumulatedItem = { kind: 'tool-call', id: 't1', title: 'Bash', status: 'completed', content: [] };

    const before = convertAcpItem(created, createdAt);
    const after = convertAcpItem(patched, createdAt);
    expect(before.id).toBe(after.id);
    expect((after.content[0] as { status?: unknown }).status).toBeUndefined(); // status isn't surfaced as a raw field on the part
    expect((after.content[0] as { isError: boolean }).isError).toBe(false);
  });
});

describe('convertAcpItems', () => {
  it('converts a full item list, resolving createdAt per id', () => {
    const items: AccumulatedItem[] = [
      { kind: 'message', id: 'u1', role: 'user', text: 'hi' },
      { kind: 'message', id: 'a1', role: 'agent', text: 'hello' },
    ];
    const stamps: Record<string, Date> = {
      u1: new Date('2026-08-28T00:00:00.000Z'),
      a1: new Date('2026-08-28T00:00:01.000Z'),
    };
    const converted = convertAcpItems(items, (id) => stamps[id]!);
    expect(converted.map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(converted[0]!.createdAt).toEqual(stamps.u1);
    expect(converted[1]!.createdAt).toEqual(stamps.a1);
  });
});
