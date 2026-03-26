import { describe, it, expect } from 'vitest';
import { buildToolResultBlocks } from '../plugins/builtin/claude/history.js';

describe('buildToolResultBlocks', () => {
  it('extracts text from array content blocks instead of JSON.stringify', () => {
    const message = {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu1',
          content: [
            { type: 'text', text: 'First paragraph.\n\nSecond paragraph.' },
            { type: 'text', text: 'More text.' },
          ],
          is_error: false,
        },
      ],
    };

    const blocks = buildToolResultBlocks(message, undefined);
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.type).toBe('tool_result');
    if (block.type === 'tool_result') {
      expect(block.content).toBe('First paragraph.\n\nSecond paragraph.\nMore text.');
      expect(block.content).not.toContain('"type"');
    }
  });

  it('handles string content unchanged', () => {
    const message = {
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'plain string result', is_error: false }],
    };
    const blocks = buildToolResultBlocks(message, undefined);
    const block = blocks[0]!;
    if (block.type === 'tool_result') {
      expect(block.content).toBe('plain string result');
    }
  });
});
