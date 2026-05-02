import { describe, it, expect } from 'vitest';
import { convertMessage } from '../convert-message';
import type { DisplayMessage } from '@qlan-ro/mainframe-types';

describe('convertMessage filters hidden tool calls', () => {
  it('omits tool_call blocks with category === hidden', () => {
    const msg: DisplayMessage = {
      id: 'm1',
      chatId: 'c1',
      type: 'assistant',
      timestamp: new Date().toISOString(),
      content: [
        { type: 'text', text: 'hi' },
        {
          type: 'tool_call',
          id: 't1',
          name: 'TodoWrite',
          input: {},
          category: 'hidden',
        },
        {
          type: 'tool_call',
          id: 't2',
          name: 'Bash',
          input: { command: 'ls' },
          category: 'default',
        },
      ],
    };

    const converted = convertMessage(msg);
    const parts = converted.content as Array<{ type: string; toolName?: string }>;
    const toolNames = parts.filter((p) => p.type === 'tool-call').map((p) => p.toolName);
    expect(toolNames).toEqual(['Bash']);
  });

  it('includes tool_call blocks with category !== hidden', () => {
    const msg: DisplayMessage = {
      id: 'm2',
      chatId: 'c1',
      type: 'assistant',
      timestamp: new Date().toISOString(),
      content: [
        {
          type: 'tool_call',
          id: 't3',
          name: 'Read',
          input: { file_path: '/tmp/foo' },
          category: 'default',
        },
        {
          type: 'tool_call',
          id: 't4',
          name: 'Grep',
          input: { pattern: 'foo' },
          category: 'explore',
        },
      ],
    };

    const converted = convertMessage(msg);
    const parts = converted.content as Array<{ type: string; toolName?: string }>;
    const toolNames = parts.filter((p) => p.type === 'tool-call').map((p) => p.toolName);
    expect(toolNames).toEqual(['Read', 'Grep']);
  });

  it('keeps text parts alongside hidden tool calls', () => {
    const msg: DisplayMessage = {
      id: 'm3',
      chatId: 'c1',
      type: 'assistant',
      timestamp: new Date().toISOString(),
      content: [
        { type: 'text', text: 'some text' },
        {
          type: 'tool_call',
          id: 't5',
          name: 'TodoWrite',
          input: {},
          category: 'hidden',
        },
      ],
    };

    const converted = convertMessage(msg);
    const parts = converted.content as Array<{ type: string; text?: string; toolName?: string }>;
    expect(parts.some((p) => p.type === 'text' && p.text === 'some text')).toBe(true);
    expect(parts.filter((p) => p.type === 'tool-call')).toHaveLength(0);
  });
});
