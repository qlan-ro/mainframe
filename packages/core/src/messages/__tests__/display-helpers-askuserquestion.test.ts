import { describe, it, expect } from 'vitest';
import { convertAssistantContent } from '../display-helpers.js';
import type { GroupedMessage } from '../message-grouping.js';

function grouped(toolUseId: string, withResult: boolean): GroupedMessage {
  const g = {
    type: 'assistant',
    content: [
      { type: 'tool_use', id: toolUseId, name: 'AskUserQuestion', input: { questions: [{ question: 'Which DB?' }] } },
    ],
    _toolResults: new Map(),
  } as unknown as GroupedMessage;
  if (withResult) {
    (g._toolResults as Map<string, unknown>).set(toolUseId, {
      type: 'tool_result',
      content:
        'User has answered your questions: "Which DB?"="Postgres". You can now continue with the user\'s answers in mind.',
      isError: false,
    });
  }
  return g;
}

describe('convertAssistantContent — AskUserQuestion', () => {
  const categories = {
    explore: new Set<string>(),
    hidden: new Set(['AskUserQuestion']),
    progress: new Set<string>(),
    subagent: new Set<string>(),
  };

  it('answered AskUserQuestion is category default with parsed answers', () => {
    const out = convertAssistantContent(grouped('tu1', true), categories);
    const call = out.find((c) => c.type === 'tool_call') as {
      category: string;
      result?: { askUserQuestion?: unknown };
    };
    expect(call).toBeTruthy();
    expect(call.category).toBe('default');
    expect(call.result?.askUserQuestion).toEqual([{ question: 'Which DB?', answer: ['Postgres'] }]);
  });

  it('pending (resultless) AskUserQuestion stays hidden', () => {
    const out = convertAssistantContent(grouped('tu2', false), categories);
    const call = out.find((c) => c.type === 'tool_call') as { category: string };
    expect(call.category).toBe('hidden');
  });
});
