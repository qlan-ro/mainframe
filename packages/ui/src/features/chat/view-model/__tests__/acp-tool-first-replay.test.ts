import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { SessionUpdateSchema } from '@qlan-ro/mainframe-types';
import { AcpItemAccumulator } from '../acp-item-accumulator';
import { convertAcpItems } from '../convert-acp-item';
import type { MainframeMessageMeta } from '../message-meta';

const fixture = new URL(
  '../../../../../../core-rs/crates/mainframe-acp/fixtures/tool-first-replay.json',
  import.meta.url,
);
const updates = SessionUpdateSchema.array().parse(JSON.parse(readFileSync(fixture, 'utf8')));
const stamp = () => new Date(0);

it('renders the Rust replay of a compacted tool-first final with completed presentation', () => {
  const accumulator = new AcpItemAccumulator({ strictCreation: true });
  accumulator.setReplaying(true);
  for (const update of updates) expect(accumulator.apply(update)).toEqual({ kind: 'applied', created: true });
  const messages = convertAcpItems(accumulator.itemsInOrder, stamp);
  expect(messages.map((message) => message.id)).toEqual(['compaction', 'exec']);
  const answer = messages[1]!;
  expect(answer.content).toMatchObject([
    { type: 'tool-call', toolCallId: 'exec', result: 'fixture' },
    { type: 'text', text: 'Final answer' },
  ]);
  expect(answer.status?.type).not.toBe('running');
  const meta = answer.metadata?.custom?.mainframe as MainframeMessageMeta;
  expect(meta.partSources?.[1]).toMatchObject([
    { streaming: false, presentation: { phase: 'final_answer', state: 'completed', finalEligible: true } },
  ]);
  for (const sources of Object.values(meta.partSources ?? {})) {
    expect(sources.every((source) => source.presentation.state === 'completed')).toBe(true);
  }
});

it('keeps native tool lookup and group identities while wire IDs link nested tasks', () => {
  const accumulator = new AcpItemAccumulator();
  for (const update of [
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool:task',
      title: 'Task',
      status: 'completed',
      _meta: { '_mainframe.dev': { containerId: 'root', subagent: true, sourceToolCallId: 'task' } },
    },
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool:child',
      title: 'Read',
      status: 'completed',
      _meta: {
        '_mainframe.dev': {
          containerId: 'task',
          parentToolCallId: 'tool:task',
          sourceToolCallId: 'child',
          groupId: 'child',
        },
      },
    },
    {
      sessionUpdate: 'agent_message',
      messageId: 'message:0:task:task',
      content: [{ type: 'text', text: 'Nested answer' }],
      _meta: { '_mainframe.dev': { containerId: 'task', parentToolCallId: 'tool:task' } },
    },
  ])
    accumulator.apply(SessionUpdateSchema.parse(update));
  const task = convertAcpItems(accumulator.itemsInOrder, stamp)[0]!.content[0];
  expect(task).toMatchObject({
    type: 'tool-call',
    toolCallId: 'task',
    messages: [
      {
        content: [{ toolCallId: 'child' }, { type: 'text', text: 'Nested answer' }],
        metadata: { custom: { mainframe: { partGroups: { child: 'child' } } } },
      },
    ],
  });
});
