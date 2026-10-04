/**
 * `TranscriptConverter` — identity across conversions. assistant-ui memoizes
 * messages and parts on object identity, so a frame that touches one item
 * must leave every other container's `ThreadMessageLike` (and its parts)
 * referentially unchanged; only the touched container, or a subagent
 * container whose child changed, converts again.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import {
  AcpItemAccumulator,
  type AccumulatedItem,
  type AccumulatedMessageItem,
  type AccumulatedToolCallItem,
} from '../acp-item-accumulator';
import { TranscriptConverter, convertAcpItems } from '../convert-acp-item';
import * as parseItemMetaModule from '../parse-item-meta';
import { streamingTailChunk, streamingTailCreate, transcriptFrames } from '../../__tests__/transcript-fixture';

const stampFor = () => new Date('2026-10-01T00:00:00.000Z');

function itemMeta(fields: Record<string, unknown>) {
  return { '_mainframe.dev': fields };
}

function messageItem(id: string, text: string, meta: Record<string, unknown>): AccumulatedMessageItem {
  return { kind: 'message', id, role: 'agent', content: [{ type: 'text', text }], meta: itemMeta(meta) };
}

function toolItem(id: string, meta: Record<string, unknown>): AccumulatedToolCallItem {
  return {
    kind: 'tool-call',
    id,
    title: 'Read',
    status: 'completed',
    content: [],
    rawInput: { file_path: `/${id}` },
    meta: itemMeta(meta),
  };
}

type PartShape = { text?: string; isError?: boolean; messages?: Array<{ content: Array<{ text?: string }> }> };

function parts(message: ThreadMessageLike): PartShape[] {
  return message.content as unknown as PartShape[];
}

describe('TranscriptConverter — identity across conversions', () => {
  it('a chunk to the live tail leaves every settled message, and its parts, referentially unchanged', () => {
    const turns = 12;
    const acc = new AcpItemAccumulator({ strictCreation: true });
    for (const update of transcriptFrames(turns)) acc.apply(update);
    acc.apply(streamingTailCreate(turns));
    const converter = new TranscriptConverter();
    const before = converter.convert(acc.itemsInOrder, stampFor);

    acc.apply(streamingTailChunk(turns, 0));
    const after = converter.convert(acc.itemsInOrder, stampFor);

    expect(after).toHaveLength(before.length);
    after.slice(0, -1).forEach((message, index) => expect(message).toBe(before[index]));
    const tailBefore = before[before.length - 1]!;
    const tailAfter = after[after.length - 1]!;
    expect(tailAfter).not.toBe(tailBefore);
    expect(tailAfter.id).toBe(tailBefore.id);
    expect(parts(tailAfter)[0]!.text).toContain('chunk 0');
  });

  it('a tool-call patch re-converts only the container that owns the tool call', () => {
    const items: AccumulatedItem[] = [
      messageItem('m1', 'first', { containerId: 'c1' }),
      toolItem('t1', { containerId: 'c1' }),
      messageItem('m2', 'second', { containerId: 'c2' }),
      toolItem('t2', { containerId: 'c2' }),
    ];
    const converter = new TranscriptConverter();
    const before = converter.convert(items, stampFor);

    const patched: AccumulatedToolCallItem = { ...toolItem('t2', { containerId: 'c2' }), status: 'failed' };
    const after = converter.convert([items[0]!, items[1]!, items[2]!, patched], stampFor);

    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(parts(after[1]!)[1]!.isError).toBe(true);
  });

  it('a subagent container re-converts when one of its child items changes', () => {
    const task = toolItem('task1', { containerId: 'c1', subagent: true });
    const child = messageItem('child1', 'exploring', { parentToolCallId: 'task1' });
    const other = messageItem('m2', 'unrelated', { containerId: 'c2' });
    const converter = new TranscriptConverter();
    const before = converter.convert([task, child, other], stampFor);

    const grown = messageItem('child1', 'exploring more', { parentToolCallId: 'task1' });
    const after = converter.convert([task, grown, other], stampFor);

    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    const nested = parts(after[0]!)[0]!.messages!;
    expect(nested[nested.length - 1]!.content[0]!.text).toBe('exploring more');
  });

  it('a container that reappears under new item objects converts fresh instead of reusing the stale message', () => {
    const a = messageItem('a', 'A', { containerId: 'a' });
    const b = messageItem('b', 'B', { containerId: 'b' });
    const converter = new TranscriptConverter();
    const first = converter.convert([a, b], stampFor);
    expect(converter.convert([a], stampFor)).toHaveLength(1);

    const bAgain = messageItem('b', 'B again', { containerId: 'b' });
    const third = converter.convert([a, bAgain], stampFor);
    expect(third[0]).toBe(first[0]);
    expect(third[1]).not.toBe(first[1]);
    expect(parts(third[1]!)[0]!.text).toBe('B again');
  });

  it('parses each item object once, however many times the transcript converts', () => {
    const spy = vi.spyOn(parseItemMetaModule, 'parseItemMeta');
    const items: AccumulatedItem[] = [
      messageItem('m1', 'first', { containerId: 'c1' }),
      toolItem('t1', { containerId: 'c1' }),
    ];
    const converter = new TranscriptConverter();
    converter.convert(items, stampFor);
    converter.convert(items, stampFor);
    converter.convert(items, stampFor);
    expect(spy).toHaveBeenCalledTimes(items.length);
    spy.mockRestore();
  });

  it('the one-shot entry converts exactly like a fresh converter', () => {
    const items: AccumulatedItem[] = [
      messageItem('m1', 'first', { containerId: 'c1' }),
      toolItem('t1', { containerId: 'c1' }),
      messageItem('m2', 'second', { containerId: 'c2' }),
    ];
    expect(convertAcpItems(items, stampFor)).toEqual(new TranscriptConverter().convert(items, stampFor));
  });
});
