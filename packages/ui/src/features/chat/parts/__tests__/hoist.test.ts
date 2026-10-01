/**
 * Ported from Fable's `/tmp/mf-smooth/hoist.test.ts` (long-chat-and-streaming
 * plan task U3) — documents the client half of the encoder's text-hoisting
 * behavior (`mainframe-acp::encoder::content::push_text`): once a text chunk
 * has already landed in an item's first text block, a LATER chunk on the
 * same item id always coalesces into that same first block, even after a
 * tool call has since been appended to the item. The wire gives the client
 * no way to place new text after the tool — the daemon's own encoder already
 * decided this text belongs to the segment that was open when it arrived.
 */
import { describe, it, expect } from 'vitest';
import type { SessionUpdate } from '@qlan-ro/mainframe-types';
import { AcpItemAccumulator } from '../../view-model/acp-item-accumulator';
import { convertAcpItems } from '../../view-model/convert-acp-item';

const NS = '_mainframe.dev';
const meta = () => ({ [NS]: { containerId: 'M1', timestamp: '2026-10-01T00:00:00Z' } });

function partsOf(acc: AcpItemAccumulator): Array<{ id: string; parts: string[] }> {
  return convertAcpItems(acc.itemsInOrder, () => new Date(0)).map((m) => ({
    id: m.id as string,
    parts: (m.content as Array<{ type: string; text?: string; toolCallId?: string }>).map((p) =>
      p.type === 'text' ? `text:${p.text}` : p.type === 'tool-call' ? `tool:${p.toolCallId}` : p.type,
    ),
  }));
}

describe('client half of the hoisting path (what the wire shape forces the UI to render)', () => {
  it('a text chunk arriving after a tool call lands in the FIRST text part, above the tool', () => {
    const acc = new AcpItemAccumulator();
    acc.apply({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'M1',
      content: { type: 'text', text: 'Let me read the file.' },
      _meta: meta(),
    } as SessionUpdate);
    acc.apply({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'toolu_1',
      title: 'Read',
      kind: 'read',
      status: 'completed',
      content: [],
      rawInput: { file_path: 'a.rs' },
      _meta: meta(),
    } as SessionUpdate);
    expect(partsOf(acc)).toEqual([{ id: 'M1', parts: ['text:Let me read the file.', 'tool:toolu_1'] }]);

    // The daemon's encoder hoists the next API message's text into item M1
    // (encoder/content.rs push_text), so the wire carries it as a chunk on
    // M1 — and the client has no way to put it after the tool.
    acc.apply({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'M1',
      content: { type: 'text', text: 'The file contains X.' },
      _meta: meta(),
    } as SessionUpdate);
    expect(partsOf(acc)).toEqual([
      { id: 'M1', parts: ['text:Let me read the file.The file contains X.', 'tool:toolu_1'] },
    ]);
  });
});
