import { describe, expect, it } from 'vitest';
import { AcpItemAccumulator, type AccumulatedToolCallItem } from '../acp-item-accumulator';
import { convertAcpItems } from '../convert-acp-item';
import type { ContentPart } from '../content';

type ToolPart = Extract<ContentPart, { type: 'tool-call' }>;
const stamp = () => new Date('2026-10-02T00:00:00Z');
const project = (items: AccumulatedToolCallItem[]) => convertAcpItems(items, stamp)[0]!.content as ToolPart[];

it('preserves an active ACP lifecycle even when partial output exists', () => {
  const [part] = project([
    {
      kind: 'tool-call',
      id: 'call',
      title: 'Bash',
      status: 'in_progress',
      content: [{ type: 'content', content: { type: 'text', text: 'partial output' } }],
    },
  ]);
  expect(part).toMatchObject({
    toolCallId: 'call',
    result: 'partial output',
    providerMetadata: { mainframe: { acpStatus: 'in_progress' } },
  });
});

describe('empty tool results', () => {
  it.each(['completed', 'failed'] as const)('normalizes explicit %s with no output', (status) => {
    const [part] = project([{ kind: 'tool-call', id: 'call', status, content: [] }]);
    expect(part?.result).toBe('');
    expect(part?.isError).toBe(status === 'failed' ? true : undefined);
    expect(part?.providerMetadata).toEqual({ mainframe: { acpStatus: status } });
  });

  it.each(['pending', 'in_progress', 'cancelled', undefined] as const)(
    'does not invent a terminal result for %s',
    (status) => {
      const [part] = project([{ kind: 'tool-call', id: 'call', status, content: [] }]);
      expect(part?.result).toBeUndefined();
      expect(part?.isError).toBeUndefined();
      expect(part?.providerMetadata).toEqual(status ? { mainframe: { acpStatus: status } } : undefined);
    },
  );
});

it.each(['pending', 'in_progress'] as const)('keeps %s during partial output', (status) => {
  const [part] = project([
    {
      kind: 'tool-call',
      id: 'call',
      status,
      content: [{ type: 'content', content: { type: 'text', text: 'done failed cancelled' } }],
    },
  ]);
  expect(part?.providerMetadata).toEqual({ mainframe: { acpStatus: status } });
  expect(part?.isError).toBeUndefined();
});

it('keeps call ordering and IDs across duplicate updates and replay', () => {
  const accumulator = new AcpItemAccumulator();
  for (const toolCallId of ['first', 'second']) {
    accumulator.apply({
      sessionUpdate: 'tool_call_update',
      toolCallId,
      title: 'Bash',
      status: 'pending',
      _meta: { '_mainframe.dev': { containerId: 'turn' } },
    });
  }
  const initial = convertAcpItems(accumulator.itemsInOrder, stamp)[0]!;
  for (let replay = 0; replay < 2; replay++) {
    accumulator.setReplaying(true);
    accumulator.apply({ sessionUpdate: 'tool_call_update', toolCallId: 'first', status: 'completed' });
    accumulator.apply({ sessionUpdate: 'tool_call_update', toolCallId: 'second', status: 'in_progress' });
  }
  const current = convertAcpItems(accumulator.itemsInOrder, stamp)[0]!;
  expect(current.id).toBe(initial.id);
  expect((initial.content as ToolPart[]).map((part) => part.toolCallId)).toEqual(['first', 'second']);
  expect((current.content as ToolPart[]).map((part) => part.toolCallId)).toEqual(['first', 'second']);
  expect(current.content).toMatchObject([
    { result: '', providerMetadata: { mainframe: { acpStatus: 'completed' } } },
    { result: undefined, providerMetadata: { mainframe: { acpStatus: 'in_progress' } } },
  ]);
});

it('preserves nested call IDs and lifecycle on replayed tasks', () => {
  const [task] = project([
    {
      kind: 'tool-call',
      id: 'task',
      status: 'completed',
      content: [],
      origin: 'replay',
      meta: { '_mainframe.dev': { subagent: true } },
    },
    {
      kind: 'tool-call',
      id: 'child',
      title: 'Bash',
      status: 'failed',
      content: [],
      origin: 'replay',
      meta: { '_mainframe.dev': { parentToolCallId: 'task' } },
    },
  ]);
  expect(task).toMatchObject({ toolCallId: 'task', toolName: 'Task', result: '' });
  expect(task?.messages?.[0]).toMatchObject({
    id: 'task:transcript',
    content: [
      { toolCallId: 'child', result: '', isError: true, providerMetadata: { mainframe: { acpStatus: 'failed' } } },
    ],
  });
});
