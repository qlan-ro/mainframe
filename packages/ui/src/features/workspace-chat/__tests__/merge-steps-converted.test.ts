import type { ThreadMessage } from '@assistant-ui/react';
import { expect, it } from 'vitest';
import { AcpItemAccumulator } from '@/features/chat/view-model/acp-item-accumulator';
import { TranscriptConverter } from '@/features/chat/view-model/convert-acp-item';
import type { MainframeMessageMeta } from '@/features/chat/view-model/message-meta';
import { normalizeNativeMessage } from '@/features/chat/view-model/normalize-native-messages';
import { mergeSteps } from '../merge-steps';

const META = '_mainframe.dev';
const child = { created: true, parentToolCallId: 'task' };
const call = (id: string) => ({
  sessionUpdate: 'tool_call_update',
  toolCallId: id,
  title: 'Read',
  status: 'completed',
  rawInput: {},
  _meta: { [META]: child },
});
const thought = (id: string, text: string) => ({
  sessionUpdate: 'agent_thought',
  messageId: id,
  content: [{ type: 'text', text }],
  _meta: { [META]: child },
});
const message = (id: string, text: string) => ({
  sessionUpdate: 'agent_message',
  messageId: id,
  content: [{ type: 'text', text }],
  _meta: { [META]: child },
});

/** A copy of the agent's steps, built the way both copies are: through the converter. */
function stepsOf(children: unknown[]): ThreadMessage {
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
    ...children,
  ] as never);
  const [top] = new TranscriptConverter()
    .convert(accumulator.itemsInOrder, () => new Date(0))
    .map(normalizeNativeMessage);
  const part = top!.content.find((p) => p.type === 'tool-call') as unknown as { messages: ThreadMessage[] };
  return part.messages.find((m) => m.id === 'task:transcript')!;
}

const keys = (m: ThreadMessage) => (m.metadata.custom.mainframe as MainframeMessageMeta).partKeys;
const types = (m: ThreadMessage) => m.content.map((p) => (p as { type: string }).type);

it('keeps the steps above the floor when either copy holds a blank thought or a whitespace-only text', () => {
  // The fetched copy: an empty thought and a whitespace block between its steps.
  const fetched = stepsOf([call('s1'), thought('th0', ''), message('m0', '  \n'), call('s2')]);
  // The stream's: a thought that has just started, empty, after its newest step.
  const live = stepsOf([call('s2'), thought('th1', 'now thinking'), call('s3'), thought('th2', '')]);

  expect(keys(fetched)).toEqual(['s1#call', 's2#call']);
  expect(keys(live)).toEqual(['s2#call', 'th1#thought', 's3#call']);

  const [merged] = mergeSteps([fetched], [live]);
  expect(keys(merged!)).toEqual(['s1#call', 's2#call', 'th1#thought', 's3#call']);
  expect(types(merged!)).toEqual(['tool-call', 'tool-call', 'reasoning', 'tool-call']);
});

it('puts a part only the stream has right after the part before it', () => {
  const fetched = stepsOf([call('a'), call('b')]);
  const live = stepsOf([call('a'), thought('x', 'between'), call('b')]);
  const [merged] = mergeSteps([fetched], [live]);
  expect(keys(merged!)).toEqual(['a#call', 'x#thought', 'b#call']);
});
