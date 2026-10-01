/**
 * `convertAcpItems` — D6 part/message status from `ItemMeta.streaming` and
 * `AccumulatedItem.origin` (long-chat-and-streaming plan task U3), plus the
 * "no id fallback" tool-name rule split out of the D3 strict-accumulator
 * work (U1). Split from `convert-acp-item.test.ts` to keep each file under
 * the 300-line cap.
 */
import { describe, expect, it } from 'vitest';
import type { AccumulatedItem } from '../acp-item-accumulator';
import type { ContentPart } from '../content';
import { convertAcpItems } from '../convert-acp-item';

const stampFor = () => new Date('2026-08-28T00:00:00.000Z');

function textBlock(text: string) {
  return { type: 'text' as const, text };
}

function itemMeta(fields: Record<string, unknown>) {
  return { '_mainframe.dev': fields };
}

describe('convertAcpItems — streaming status (D6)', () => {
  it('an item with streaming: true yields a running text part and a running message', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'm1',
        role: 'agent',
        content: [textBlock('typing')],
        meta: itemMeta({ containerId: 'm1', streaming: true }),
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.status).toEqual({ type: 'running' });
    expect(container.content).toEqual([{ type: 'text', text: 'typing', status: { type: 'running' } }]);
  });

  it('a replay-origin item yields complete parts and no running message status', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'm1',
        role: 'agent',
        content: [textBlock('replayed answer')],
        meta: itemMeta({ containerId: 'm1' }),
        origin: 'replay',
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.status).toBeUndefined();
    expect(container.content).toEqual([{ type: 'text', text: 'replayed answer', status: { type: 'complete' } }]);
  });

  it('a replay-origin item that is also streaming: true yields a running part — streaming wins', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'm1',
        role: 'agent',
        content: [textBlock('continuing after a mid-turn replay')],
        meta: itemMeta({ containerId: 'm1', streaming: true }),
        origin: 'replay',
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.status).toEqual({ type: 'running' });
    expect(container.content).toEqual([
      { type: 'text', text: 'continuing after a mid-turn replay', status: { type: 'running' } },
    ]);
  });

  it('an item created live (no streaming, no replay origin) carries no part status, and no running message status', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'm1',
        role: 'agent',
        content: [textBlock('plain')],
        meta: itemMeta({ containerId: 'm1' }),
        origin: 'live',
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.status).toBeUndefined();
    expect(container.content).toEqual([{ type: 'text', text: 'plain' }]);
  });

  it('[text, tool, text] gives parts [text, tool-call, text] — only the streaming last text is running', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'c1',
        role: 'agent',
        content: [textBlock('before the tool')],
        meta: itemMeta({ containerId: 'c1' }),
        origin: 'live',
      },
      {
        kind: 'tool-call',
        id: 't1',
        title: 'Read',
        status: 'completed',
        content: [],
        rawInput: {},
        meta: itemMeta({ containerId: 'c1' }),
      },
      {
        kind: 'message',
        id: 'c1-1',
        role: 'agent',
        content: [textBlock('after the tool')],
        meta: itemMeta({ containerId: 'c1', streaming: true }),
        origin: 'live',
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    const content = container.content as ContentPart[];
    expect(content.map((p) => p.type)).toEqual(['text', 'tool-call', 'text']);
    expect(content[0]).toEqual({ type: 'text', text: 'before the tool' });
    expect(content[2]).toEqual({ type: 'text', text: 'after the tool', status: { type: 'running' } });
    expect(container.status).toEqual({ type: 'running' });
  });
});

describe('convertAcpItems — tool name never falls back to the id (D3)', () => {
  it('a tool item without a title gets toolName: "Unknown tool", never its id', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'tool-call',
        id: 'tool-call-id-should-never-render',
        status: 'pending',
        content: [],
        meta: itemMeta({ containerId: 'tool-call-id-should-never-render' }),
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'tool-call-id-should-never-render',
        toolName: 'Unknown tool',
        args: {},
        result: undefined,
        isError: undefined,
      },
    ]);
  });
});
