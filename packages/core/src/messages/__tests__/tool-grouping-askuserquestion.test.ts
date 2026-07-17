import { describe, it, expect } from 'vitest';
import { groupToolCallParts } from '../tool-grouping.js';
import { prepareMessagesForClient } from '../display-pipeline.js';
import { convertAssistantContent } from '../display-helpers.js';
import type { GroupedMessage } from '../message-grouping.js';
import type { ToolCategories } from '@qlan-ro/mainframe-types';

const categories: ToolCategories = {
  explore: new Set(),
  hidden: new Set(['AskUserQuestion']),
  progress: new Set(),
  subagent: new Set(),
};

function part(id: string, hasResult: boolean) {
  return {
    type: 'tool-call' as const,
    toolCallId: id,
    toolName: 'AskUserQuestion',
    args: { questions: [] },
    category: hasResult ? 'default' : 'hidden',
    ...(hasResult ? { result: { content: 'x', isError: false } } : {}),
    isError: false,
  };
}

describe('groupToolCallParts — AskUserQuestion', () => {
  it('keeps an answered (default, has result) AskUserQuestion part', () => {
    const out = groupToolCallParts([part('a', true)] as never, categories);
    expect(out.some((p) => (p as { toolCallId?: string }).toolCallId === 'a')).toBe(true);
  });

  it('drops a pending (hidden, no result) AskUserQuestion part', () => {
    const out = groupToolCallParts([part('b', false)] as never, categories);
    expect(out.some((p) => (p as { toolCallId?: string }).toolCallId === 'b')).toBe(false);
  });
});

// Layer-specific: convertAssistantContent must categorize a resultless
// AskUserQuestion as hidden — the answered path is covered end-to-end below.
it('convertAssistantContent keeps a pending (resultless) AskUserQuestion hidden', () => {
  const grouped = {
    type: 'assistant',
    content: [
      { type: 'tool_use', id: 'tu2', name: 'AskUserQuestion', input: { questions: [{ question: 'Which DB?' }] } },
    ],
    _toolResults: new Map(),
  } as unknown as GroupedMessage;

  const out = convertAssistantContent(grouped, categories);
  const call = out.find((c) => c.type === 'tool_call') as { category: string };
  expect(call.category).toBe('hidden');
});

it('prepareMessagesForClient yields one default AskUserQuestion tool_call with parsed answers', () => {
  const cats: ToolCategories = {
    explore: new Set(),
    hidden: new Set(['AskUserQuestion']),
    progress: new Set(),
    subagent: new Set(),
  };
  const raw = [
    {
      id: 'msg-1',
      chatId: 'chat-1',
      timestamp: '2024-01-01T00:00:00.000Z',
      type: 'assistant' as const,
      content: [
        {
          type: 'tool_use' as const,
          id: 'tu',
          name: 'AskUserQuestion',
          input: { questions: [{ question: 'Which DB?' }] },
        },
      ],
    },
    {
      id: 'msg-2',
      chatId: 'chat-1',
      timestamp: '2024-01-01T00:00:01.000Z',
      type: 'tool_result' as const,
      content: [
        {
          type: 'tool_result' as const,
          toolUseId: 'tu',
          content:
            'User has answered your questions: "Which DB?"="Postgres". You can now continue with the user\'s answers in mind.',
          isError: false,
        },
      ],
    },
  ];
  const msgs = prepareMessagesForClient(raw as never, cats);
  const allContent = (msgs as Array<{ content: unknown[] }>).flatMap((mm) => mm.content);
  const calls = allContent.filter((c) => (c as { type?: string }).type === 'tool_call');
  const auq = calls.find((c) => (c as { name?: string }).name === 'AskUserQuestion') as {
    category: string;
    result?: { askUserQuestion?: unknown };
  };
  expect(auq).toBeTruthy();
  expect(auq.category).toBe('default');
  expect(auq.result?.askUserQuestion).toEqual([{ question: 'Which DB?', answer: ['Postgres'] }]);
});
