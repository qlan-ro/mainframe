import { describe, expect, it } from 'vitest';
import type { SessionUpdate } from '@qlan-ro/mainframe-types';
import { AcpItemAccumulator } from '../acp-item-accumulator';

function textBlock(text: string) {
  return { type: 'text' as const, text };
}

describe('AcpItemAccumulator — message/thought chunk + upsert', () => {
  it('a chunk creates the item, then appends on each subsequent chunk', () => {
    const acc = new AcpItemAccumulator();
    acc.apply({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: textBlock('Looking ') });
    acc.apply({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: textBlock('into it') });

    expect(acc.itemsInOrder).toEqual([
      { kind: 'message', id: 'm1', role: 'agent', text: 'Looking into it', meta: undefined },
    ]);
  });

  it('an upsert with content replaces the accumulated text wholesale (the retry case)', () => {
    const acc = new AcpItemAccumulator();
    acc.apply({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: textBlock('stale draft') });
    acc.apply({
      sessionUpdate: 'agent_message',
      messageId: 'm1',
      content: [textBlock('replacement text')],
      _meta: { '_mainframe.dev': { attempt: 2 } },
    });

    expect(acc.itemsInOrder).toEqual([
      {
        kind: 'message',
        id: 'm1',
        role: 'agent',
        text: 'replacement text',
        meta: { '_mainframe.dev': { attempt: 2 } },
      },
    ]);
  });

  it('an upsert with content: null clears the accumulated text', () => {
    const acc = new AcpItemAccumulator();
    acc.apply({ sessionUpdate: 'user_message_chunk', messageId: 'm1', content: textBlock('hello') });
    acc.apply({ sessionUpdate: 'user_message', messageId: 'm1', content: null });

    expect(acc.itemsInOrder).toEqual([{ kind: 'message', id: 'm1', role: 'user', text: '', meta: undefined }]);
  });

  it('an upsert with content omitted leaves the accumulated text unchanged (only meta patched)', () => {
    const acc = new AcpItemAccumulator();
    acc.apply({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: textBlock('unchanged') });
    acc.apply({ sessionUpdate: 'agent_message', messageId: 'm1', _meta: { flag: true } });

    expect(acc.itemsInOrder).toEqual([
      { kind: 'message', id: 'm1', role: 'agent', text: 'unchanged', meta: { flag: true } },
    ]);
  });

  it('agent_thought(_chunk) accumulates as a distinct item from agent_message on the same container id', () => {
    const acc = new AcpItemAccumulator();
    acc.apply({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: textBlock('answer') });
    acc.apply({ sessionUpdate: 'agent_thought_chunk', messageId: 'm1-thought', content: textBlock('reasoning') });

    expect(acc.itemsInOrder).toEqual([
      { kind: 'message', id: 'm1', role: 'agent', text: 'answer', meta: undefined },
      { kind: 'thought', id: 'm1-thought', text: 'reasoning', meta: undefined },
    ]);
  });
});

describe('AcpItemAccumulator — tool_call_update patch grammar', () => {
  it('the first update creates the tool call with every field it sends', () => {
    const acc = new AcpItemAccumulator();
    acc.apply({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      title: 'Read package.json',
      kind: 'read',
      status: 'pending',
      content: [],
      locations: [{ path: '/repo/package.json' }],
      rawInput: { file_path: '/repo/package.json' },
    });

    expect(acc.itemsInOrder).toEqual([
      {
        kind: 'tool-call',
        id: 't1',
        title: 'Read package.json',
        toolKind: 'read',
        status: 'pending',
        content: [],
        locations: [{ path: '/repo/package.json' }],
        rawInput: { file_path: '/repo/package.json' },
        rawOutput: undefined,
        meta: undefined,
      },
    ]);
  });

  it('an omitted field on a later patch leaves the existing value unchanged', () => {
    const acc = new AcpItemAccumulator();
    acc.apply({ sessionUpdate: 'tool_call_update', toolCallId: 't1', title: 'Read package.json', status: 'pending' });
    acc.apply({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'in_progress' });

    const item = acc.itemsInOrder[0];
    expect(item).toMatchObject({ title: 'Read package.json', status: 'in_progress' });
  });

  it('an explicit null on a later patch clears the field', () => {
    const acc = new AcpItemAccumulator();
    acc.apply({ sessionUpdate: 'tool_call_update', toolCallId: 't1', title: 'Bash', rawInput: { command: 'ls' } });
    acc.apply({ sessionUpdate: 'tool_call_update', toolCallId: 't1', rawInput: null });

    expect(acc.itemsInOrder[0]).toMatchObject({ title: 'Bash', rawInput: undefined });
  });

  it('a value patch replaces the field', () => {
    const acc = new AcpItemAccumulator();
    acc.apply({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'pending' });
    acc.apply({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });

    expect(acc.itemsInOrder[0]).toMatchObject({ status: 'completed' });
  });
});

describe('AcpItemAccumulator — tool_call_content_chunk', () => {
  it('appends one content item to the tool call, creating it if absent', () => {
    const acc = new AcpItemAccumulator();
    acc.apply({
      sessionUpdate: 'tool_call_content_chunk',
      toolCallId: 't1',
      content: { type: 'content', content: textBlock('{\n  "name": ') },
    });
    acc.apply({
      sessionUpdate: 'tool_call_content_chunk',
      toolCallId: 't1',
      content: { type: 'content', content: textBlock('"mainframe"\n}') },
    });

    const item = acc.itemsInOrder[0]!;
    expect(item.kind).toBe('tool-call');
    expect(item.kind === 'tool-call' && item.content).toEqual([
      { type: 'content', content: textBlock('{\n  "name": ') },
      { type: 'content', content: textBlock('"mainframe"\n}') },
    ]);
  });
});

describe('AcpItemAccumulator — subagent attribution', () => {
  it('preserves the _mainframe.dev parentToolCallId meta on a flattened tool call', () => {
    const acc = new AcpItemAccumulator();
    acc.apply({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'sub-1',
      title: 'Grep for TODO',
      _meta: { '_mainframe.dev': { parentToolCallId: 'agent-1' } },
    });

    expect(acc.itemsInOrder[0]!.meta).toEqual({ '_mainframe.dev': { parentToolCallId: 'agent-1' } });
  });
});

describe('AcpItemAccumulator — ordering and session-level state', () => {
  it('preserves first-seen order across item kinds', () => {
    const acc = new AcpItemAccumulator();
    acc.apply({ sessionUpdate: 'user_message', messageId: 'u1', content: [textBlock('hi')] });
    acc.apply({ sessionUpdate: 'tool_call_update', toolCallId: 't1', title: 'Bash' });
    acc.apply({ sessionUpdate: 'agent_message_chunk', messageId: 'a1', content: textBlock('ok') });

    expect(acc.itemsInOrder.map((i) => i.id)).toEqual(['u1', 't1', 'a1']);
  });

  it('tracks the latest state_update and usage_update without creating items', () => {
    const acc = new AcpItemAccumulator();
    const state: SessionUpdate = { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' };
    acc.apply(state);
    acc.apply({ sessionUpdate: 'usage_update', used: 100, size: 200000 });

    expect(acc.latestTurnState).toEqual(state);
    expect(acc.latestUsage).toEqual({ sessionUpdate: 'usage_update', used: 100, size: 200000 });
    expect(acc.itemsInOrder).toEqual([]);
  });

  it('reset() clears items and session-level state', () => {
    const acc = new AcpItemAccumulator();
    acc.apply({ sessionUpdate: 'user_message', messageId: 'u1', content: [textBlock('hi')] });
    acc.apply({ sessionUpdate: 'usage_update', used: 1, size: 2 });

    acc.reset();

    expect(acc.itemsInOrder).toEqual([]);
    expect(acc.latestUsage).toBeNull();
  });
});
