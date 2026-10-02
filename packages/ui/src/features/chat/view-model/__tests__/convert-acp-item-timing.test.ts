import type { ThreadMessageLike } from '@assistant-ui/react';
import { MAINFRAME_META_NAMESPACE, type SessionUpdate } from '@qlan-ro/mainframe-types';
import { describe, expect, it } from 'vitest';
import { AcpItemAccumulator, type AccumulatedItem } from '../acp-item-accumulator';
import { convertAcpItems } from '../convert-acp-item';

const startedAt = 1790899200123;
const completedAt = 1790899201456;
const stampFor = () => new Date('2026-10-01T00:00:00.000Z');

function call(id: string, meta: Record<string, unknown> = {}): AccumulatedItem {
  return {
    kind: 'tool-call',
    id,
    title: 'Bash',
    status: 'in_progress',
    content: [],
    meta: { [MAINFRAME_META_NAMESPACE]: { containerId: 'container', ...meta } },
  };
}

function toolParts(messages: readonly ThreadMessageLike[]) {
  return messages
    .flatMap((message) => (typeof message.content === 'string' ? [] : message.content))
    .filter((part) => part.type === 'tool-call');
}

function frame(
  id: string,
  timing: unknown,
  extra: Record<string, unknown> = {},
): Extract<SessionUpdate, { sessionUpdate: 'tool_call_update' }> {
  return {
    sessionUpdate: 'tool_call_update',
    toolCallId: id,
    title: 'Bash',
    status: 'in_progress',
    _meta: {
      [MAINFRAME_META_NAMESPACE]: {
        created: true,
        containerId: 'container',
        groupId: 'group',
        toolCallTiming: timing,
        ...extra,
      },
    },
  };
}

describe('native tool call timing', () => {
  it.each(['live', 'replay'] as const)(
    'preserves exact per-call milliseconds for %s items in one container',
    (origin) => {
      const messages = convertAcpItems(
        [
          { ...call('a', { toolCallTiming: { startedAt, completedAt } }), origin },
          { ...call('b', { toolCallTiming: { startedAt: startedAt + 200 } }), origin },
        ],
        stampFor,
      );
      expect(messages).toHaveLength(1);
      expect(toolParts(messages).map((part) => [part.toolCallId, part.timing])).toEqual([
        ['a', { startedAt: 1790899200123, completedAt: 1790899201456 }],
        ['b', { startedAt: 1790899200323 }],
      ]);
    },
  );

  it('preserves independent timing through nested Task messages', () => {
    const messages = convertAcpItems(
      [
        call('parent', { subagent: true, toolCallTiming: { startedAt } }),
        call('child', { parentToolCallId: 'parent', subagent: true, toolCallTiming: { startedAt: startedAt + 100 } }),
        call('grandchild', { parentToolCallId: 'child', toolCallTiming: { startedAt: startedAt + 200, completedAt } }),
      ],
      stampFor,
    );
    const parent = toolParts(messages)[0]!;
    const child = toolParts(parent.messages ?? [])[0]!;
    const grandchild = toolParts(child.messages ?? [])[0]!;
    expect(parent.timing).toEqual({ startedAt: 1790899200123 });
    expect(child.timing).toEqual({ startedAt: 1790899200223 });
    expect(grandchild.timing).toEqual({ startedAt: 1790899200323, completedAt: 1790899201456 });
  });

  it('keeps malformed timing isolated from parent and container metadata', () => {
    const messages = convertAcpItems(
      [
        call('parent', { subagent: true }),
        call('child', { parentToolCallId: 'parent', toolCallTiming: { startedAt: 'bad' } }),
      ],
      stampFor,
    );
    expect(messages.map((message) => message.id)).toEqual(['container']);
    const child = toolParts(toolParts(messages)[0]!.messages ?? [])[0]!;
    expect(child.toolCallId).toBe('child');
    expect(child).not.toHaveProperty('timing');
  });

  it('leaves legacy timing absent regardless of the container timestamp and turn duration', () => {
    const parts = toolParts(
      convertAcpItems(
        [
          call('legacy', {
            timestamp: '2026-10-01T00:00:00.000Z',
            messageMeta: { turnDurationMs: 1234 },
          }),
        ],
        stampFor,
      ),
    );
    expect(parts[0]).not.toHaveProperty('timing');
  });

  it('stops cancellation timing without fabricating a provider result', () => {
    const part = toolParts(
      convertAcpItems([call('cancelled', { toolCallTiming: { startedAt, completedAt } })], stampFor),
    )[0]!;
    expect(part.timing).toEqual({ startedAt: 1790899200123, completedAt: 1790899201456 });
    expect(part.result).toBeUndefined();
  });

  it('matches live completion patches to fresh replay while retaining unrelated metadata', () => {
    const live = new AcpItemAccumulator({ strictCreation: true });
    live.apply(frame('a', { startedAt }));
    live.apply(frame('b', { startedAt: startedAt + 200 }));
    expect(toolParts(convertAcpItems(live.itemsInOrder, stampFor))[0]!.timing).toEqual({ startedAt });
    live.apply({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'a',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: '' } }],
    });
    live.apply({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'a',
      _meta: {
        [MAINFRAME_META_NAMESPACE]: {
          containerId: 'container',
          groupId: 'group',
          toolCallTiming: { startedAt, completedAt },
        },
      },
    });
    const replay = new AcpItemAccumulator({ strictCreation: true });
    replay.setReplaying(true);
    replay.apply({
      ...frame('a', { startedAt, completedAt }),
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: '' } }],
    });
    replay.apply(frame('b', { startedAt: startedAt + 200 }));
    const liveMessages = convertAcpItems(live.itemsInOrder, stampFor);
    expect(liveMessages).toEqual(convertAcpItems(replay.itemsInOrder, stampFor));
    expect(toolParts(liveMessages).map((part) => [part.toolCallId, part.timing])).toEqual([
      ['a', { startedAt: 1790899200123, completedAt: 1790899201456 }],
      ['b', { startedAt: 1790899200323 }],
    ]);
    expect(liveMessages[0]!.metadata?.custom?.mainframe).toMatchObject({ partGroups: { a: 'group', b: 'group' } });
  });
});
