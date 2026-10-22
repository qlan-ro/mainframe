import { expect, it } from 'vitest';
import type { SessionUpdate } from '@qlan-ro/mainframe-types';
import { AcpItemAccumulator } from '../acp-item-accumulator';

it('places an earlier child after its shared parent and preserves the current parent value', () => {
  const message = (id: string, text: string): SessionUpdate => ({
    sessionUpdate: 'agent_message',
    messageId: id,
    content: [{ type: 'text', text }],
  });
  const acc = new AcpItemAccumulator();
  acc.apply(message('parent', 'current'));
  acc.apply(message('child-newer', 'newer'));
  acc.prepend([message('older-turn', 'older'), message('parent', 'stale'), message('child-earlier', 'earlier')]);
  expect(acc.itemsInOrder.map((item) => item.id)).toEqual(['older-turn', 'parent', 'child-earlier', 'child-newer']);
  expect(acc.itemsInOrder[1]).toMatchObject({ content: [{ type: 'text', text: 'current' }] });
});
