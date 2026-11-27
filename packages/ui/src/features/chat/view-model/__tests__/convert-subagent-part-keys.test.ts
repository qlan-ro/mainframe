import { expect, it } from 'vitest';
import { AcpItemAccumulator } from '../acp-item-accumulator';
import { TranscriptConverter } from '../convert-acp-item';
import type { MainframeMessageMeta } from '../message-meta';
import { normalizeNativeMessage } from '../normalize-native-messages';

const META = '_mainframe.dev';
const child = { created: true, parentToolCallId: 'task' };

it('names every step of a sub-agent uniquely, whatever its kind and however many blocks an item has', () => {
  const accumulator = new AcpItemAccumulator();
  accumulator.prepend([
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'task',
      title: 'Agent',
      status: 'in_progress',
      rawInput: { prompt: 'go' },
      _meta: { [META]: { created: true, subagent: true } },
    },
    {
      sessionUpdate: 'agent_message',
      messageId: 'm1',
      content: [
        { type: 'text', text: 'first' },
        { type: 'image', mimeType: 'image/png', data: 'AA' },
        { type: 'text', text: 'last' },
      ],
      _meta: { [META]: child },
    },
    {
      sessionUpdate: 'agent_thought',
      messageId: 'th1',
      content: [{ type: 'text', text: 'hm' }],
      _meta: { [META]: child },
    },
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 's1',
      title: 'Read',
      status: 'completed',
      rawInput: {},
      _meta: { [META]: child },
    },
  ] as never);
  const [message] = new TranscriptConverter()
    .convert(accumulator.itemsInOrder, () => new Date(0))
    .map(normalizeNativeMessage);
  const call = message!.content.find((part) => part.type === 'tool-call')!;
  const transcript = (
    call as unknown as { messages: { id: string; metadata: { custom: { mainframe?: MainframeMessageMeta } } }[] }
  ).messages.find((step) => step.id === 'task:transcript')!;
  const keys = transcript.metadata.custom.mainframe?.partKeys;
  expect(keys).toEqual(['m1#0', 'm1#1', 'm1#2', 'th1#thought', 's1#call']);
  expect(new Set(keys).size).toBe(keys!.length);
});
