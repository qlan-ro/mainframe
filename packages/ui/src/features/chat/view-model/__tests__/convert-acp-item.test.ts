/**
 * `convertAcpItems` — reaggregation, tool-group echo, cost/timing. Tool
 * result shapes + subagent nesting are in the sibling
 * convert-acp-item-tool-results.test.ts; container mapping (user/system/
 * error/stability) is in convert-acp-item-containers.test.ts (todo #350,
 * plan task 37, R2.13 — split to keep each file under the 300-line cap).
 */
import { describe, expect, it } from 'vitest';
import type { AccumulatedItem } from '../acp-item-accumulator';
import { convertAcpItems } from '../convert-acp-item';

const createdAt = new Date('2026-08-28T00:00:00.000Z');
const stampFor = () => createdAt;

function textBlock(text: string) {
  return { type: 'text' as const, text };
}

function itemMeta(fields: Record<string, unknown>) {
  return { '_mainframe.dev': fields };
}

describe('convertAcpItems — reaggregation', () => {
  it('folds a message + two tool-calls + a thought sharing containerId into one assistant message, parts in item order', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'm1',
        role: 'agent',
        content: [textBlock('Hello')],
        meta: itemMeta({ containerId: 'c1', timestamp: '2026-08-28T00:00:05.000Z' }),
      },
      {
        kind: 'tool-call',
        id: 't1',
        title: 'Read',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'A' } }],
        rawInput: { file_path: '/a' },
        meta: itemMeta({ containerId: 'c1' }),
      },
      {
        kind: 'tool-call',
        id: 't2',
        title: 'Write',
        status: 'completed',
        content: [],
        rawInput: {},
        meta: itemMeta({ containerId: 'c1' }),
      },
      {
        kind: 'thought',
        id: 'th1',
        content: [textBlock('thinking')],
        meta: itemMeta({ containerId: 'c1' }),
      },
    ];

    const container = convertAcpItems(items, () => new Date('2099-01-01T00:00:00.000Z'))[0]!;

    expect(container).toEqual({
      role: 'assistant',
      id: 'c1',
      createdAt: new Date('2026-08-28T00:00:05.000Z'),
      content: [
        { type: 'text', text: 'Hello' },
        {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'Read',
          args: { file_path: '/a' },
          result: 'A',
          isError: undefined,
        },
        {
          type: 'tool-call',
          toolCallId: 't2',
          toolName: 'Write',
          args: {},
          result: undefined,
          isError: undefined,
        },
        { type: 'reasoning', text: 'thinking' },
      ],
    });
  });

  it('items with different containerIds produce separate messages in first-seen order', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'm1',
        role: 'agent',
        content: [textBlock('first')],
        meta: itemMeta({ containerId: 'c1' }),
      },
      {
        kind: 'message',
        id: 'm2',
        role: 'agent',
        content: [textBlock('second')],
        meta: itemMeta({ containerId: 'c2' }),
      },
      {
        kind: 'tool-call',
        id: 't1',
        title: 'Bash',
        status: 'completed',
        content: [],
        meta: itemMeta({ containerId: 'c1' }),
      },
      {
        kind: 'tool-call',
        id: 't2',
        title: 'Bash',
        status: 'completed',
        content: [],
        meta: itemMeta({ containerId: 'c2' }),
      },
    ];

    const converted = convertAcpItems(items, stampFor);
    expect(converted.map((m) => m.id)).toEqual(['c1', 'c2']);
    expect(converted[0]!.content).toEqual([
      { type: 'text', text: 'first' },
      { type: 'tool-call', toolCallId: 't1', toolName: 'Bash', args: {}, result: undefined, isError: undefined },
    ]);
    expect(converted[1]!.content).toEqual([
      { type: 'text', text: 'second' },
      { type: 'tool-call', toolCallId: 't2', toolName: 'Bash', args: {}, result: undefined, isError: undefined },
    ]);
  });
});

describe('convertAcpItems — tool-group echo', () => {
  it('echoes groupId membership into partGroups and derives a groupSummaries entry', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'tool-call',
        id: 't1',
        title: 'Read',
        status: 'completed',
        content: [],
        rawInput: {},
        meta: itemMeta({ containerId: 'c1', groupId: 'g1' }),
      },
      {
        kind: 'tool-call',
        id: 't2',
        title: 'Read',
        status: 'completed',
        content: [],
        rawInput: {},
        meta: itemMeta({ containerId: 'c1', groupId: 'g1' }),
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.metadata).toEqual({
      custom: {
        mainframe: {
          partGroups: { t1: 'g1', t2: 'g1' },
          groupSummaries: { g1: 'Read 2 files' },
        },
      },
    });
  });
});

describe('convertAcpItems — assistant cost/timing', () => {
  it('reads cost_usd and turnDurationMs off messageMeta into metadata.custom.mainframe.cost and metadata.timing', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'a1',
        role: 'agent',
        content: [textBlock('done')],
        meta: itemMeta({ containerId: 'c3', messageMeta: { cost_usd: 0.42, turnDurationMs: 5120 } }),
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.metadata).toEqual({
      timing: { streamStartTime: 0, totalStreamTime: 5120, totalChunks: 0, toolCallCount: 0 },
      custom: { mainframe: { cost: 0.42 } },
    });
  });
});
