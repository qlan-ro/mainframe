// packages/core/src/__tests__/codex-history.test.ts
import { describe, it, expect } from 'vitest';
import { convertThreadItems } from '../plugins/builtin/codex/history.js';

describe('convertThreadItems', () => {
  it('converts agentMessage to assistant text', () => {
    const messages = convertThreadItems([{ id: 'i1', type: 'agentMessage', text: 'Hello', phase: null }], 'chat-1');
    expect(messages).toHaveLength(1);
    expect(messages[0]!.type).toBe('assistant');
    expect(messages[0]!.content).toEqual([{ type: 'text', text: 'Hello' }]);
  });

  it('converts reasoning to assistant thinking', () => {
    const messages = convertThreadItems(
      [{ id: 'i1', type: 'reasoning', summary: ['Let me think...'], content: ['details'] }],
      'chat-1',
    );
    expect(messages[0]!.content).toEqual([{ type: 'thinking', thinking: 'Let me think...' }]);
  });

  it('converts commandExecution to tool_use + tool_result pair', () => {
    const messages = convertThreadItems(
      [
        {
          id: 'i1',
          type: 'commandExecution',
          command: 'ls',
          aggregatedOutput: 'file.txt',
          exitCode: 0,
          status: 'completed' as const,
        },
      ],
      'chat-1',
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]!.type).toBe('assistant');
    expect(messages[0]!.content[0]!.type).toBe('tool_use');
    expect(messages[1]!.type).toBe('tool_result');
    expect(messages[1]!.content[0]).toEqual(
      expect.objectContaining({ type: 'tool_result', toolUseId: 'i1', isError: false }),
    );
  });

  it('converts userMessage to user text', () => {
    const messages = convertThreadItems([{ id: 'i1', type: 'userMessage', text: 'Fix the bug' }], 'chat-1');
    expect(messages[0]!.type).toBe('user');
    expect(messages[0]!.content).toEqual([{ type: 'text', text: 'Fix the bug' }]);
  });

  it('converts fileChange to tool_use + tool_result', () => {
    const messages = convertThreadItems(
      [
        {
          id: 'i2',
          type: 'fileChange',
          changes: [{ path: 'a.ts', kind: 'update' as const }],
          status: 'completed' as const,
        },
      ],
      'chat-1',
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]!.content[0]).toEqual(expect.objectContaining({ name: 'file_change' }));
  });

  it('converts mcpToolCall to tool_use + tool_result', () => {
    const messages = convertThreadItems(
      [
        {
          id: 'i3',
          type: 'mcpToolCall',
          server: 'mcp',
          tool: 'search',
          arguments: { q: 'foo' },
          result: { content: [{ found: true }], structuredContent: null },
          error: null,
          status: 'completed' as const,
        },
      ],
      'chat-1',
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]!.content[0]).toEqual(expect.objectContaining({ name: 'search' }));
  });

  it('sets chatId on all messages', () => {
    const messages = convertThreadItems([{ id: 'i1', type: 'agentMessage', text: 'Hi', phase: null }], 'my-chat');
    expect(messages[0]!.chatId).toBe('my-chat');
  });
});
