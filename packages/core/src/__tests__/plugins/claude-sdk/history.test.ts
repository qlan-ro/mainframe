import { describe, it, expect } from 'vitest';
import { convertSessionMessages } from '../../../plugins/builtin/claude-sdk/history.js';

describe('convertSessionMessages', () => {
  it('converts an assistant message with text and tool_use', () => {
    const messages = convertSessionMessages(
      [
        {
          type: 'assistant',
          uuid: 'msg-1',
          session_id: 'sess-1',
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me check' },
              { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/tmp/a.txt' } },
            ],
            usage: { input_tokens: 100, output_tokens: 50 },
            model: 'claude-opus-4-6',
          },
        },
      ] as any[],
      'chat-1',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]!.type).toBe('assistant');
    expect(messages[0]!.content).toHaveLength(2);
    expect(messages[0]!.content[0]).toEqual({ type: 'text', text: 'Let me check' });
    expect(messages[0]!.content[1]).toEqual({
      type: 'tool_use',
      id: 'tu-1',
      name: 'Read',
      input: { file_path: '/tmp/a.txt' },
    });
  });

  it('converts a user message with tool_result', () => {
    const messages = convertSessionMessages(
      [
        {
          type: 'user',
          uuid: 'msg-2',
          session_id: 'sess-1',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu-1',
                content: 'file contents here',
                is_error: false,
              },
            ],
          },
        },
      ] as any[],
      'chat-1',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]!.type).toBe('tool_result');
    expect(messages[0]!.content[0]).toMatchObject({
      type: 'tool_result',
      toolUseId: 'tu-1',
      content: 'file contents here',
      isError: false,
    });
  });

  it('converts a user text message', () => {
    const messages = convertSessionMessages(
      [
        {
          type: 'user',
          uuid: 'msg-3',
          session_id: 'sess-1',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: 'Hello Claude',
          },
        },
      ] as any[],
      'chat-1',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]!.type).toBe('user');
    expect(messages[0]!.content[0]).toEqual({ type: 'text', text: 'Hello Claude' });
  });

  it('skips messages with no content', () => {
    const messages = convertSessionMessages(
      [
        {
          type: 'assistant',
          uuid: 'msg-4',
          session_id: 'sess-1',
          parent_tool_use_id: null,
          message: { role: 'assistant', content: [] },
        },
      ] as any[],
      'chat-1',
    );

    expect(messages).toHaveLength(0);
  });

  it('converts thinking blocks', () => {
    const messages = convertSessionMessages(
      [
        {
          type: 'assistant',
          uuid: 'msg-5',
          session_id: 'sess-1',
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'Let me think about this' },
              { type: 'text', text: 'Here is my answer' },
            ],
            usage: { input_tokens: 50, output_tokens: 30 },
          },
        },
      ] as any[],
      'chat-1',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]!.content[0]).toEqual({ type: 'thinking', thinking: 'Let me think about this' });
    expect(messages[0]!.content[1]).toEqual({ type: 'text', text: 'Here is my answer' });
  });

  it('converts user message with image blocks', () => {
    const messages = convertSessionMessages(
      [
        {
          type: 'user',
          uuid: 'msg-6',
          session_id: 'sess-1',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: [
              { type: 'text', text: 'What is this?' },
              { type: 'image', source: { media_type: 'image/png', data: 'base64data' } },
            ],
          },
        },
      ] as any[],
      'chat-1',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toHaveLength(2);
    expect(messages[0]!.content[1]).toEqual({ type: 'image', mediaType: 'image/png', data: 'base64data' });
  });
});
