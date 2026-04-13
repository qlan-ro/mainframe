import { describe, it, expect } from 'vitest';
import { extractSessionFilePaths } from '../../messages/session-files.js';
import type { ChatMessage } from '@qlan-ro/mainframe-types';

function msg(type: 'assistant' | 'user', content: any[]): ChatMessage {
  return { id: '1', chatId: 'c1', type, content, timestamp: new Date().toISOString() };
}

describe('extractSessionFilePaths', () => {
  it('returns empty array for no messages', () => {
    expect(extractSessionFilePaths([])).toEqual([]);
  });

  it('extracts file_path from Write tool_use blocks', () => {
    const messages = [
      msg('assistant', [
        { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/foo/bar.ts', content: 'x' } },
      ]),
    ];
    expect(extractSessionFilePaths(messages)).toEqual(['/foo/bar.ts']);
  });

  it('extracts file_path from Edit tool_use blocks', () => {
    const messages = [
      msg('assistant', [
        {
          type: 'tool_use',
          id: 't1',
          name: 'Edit',
          input: { file_path: '/foo/bar.ts', old_string: 'a', new_string: 'b' },
        },
      ]),
    ];
    expect(extractSessionFilePaths(messages)).toEqual(['/foo/bar.ts']);
  });

  it('deduplicates paths across multiple messages', () => {
    const messages = [
      msg('assistant', [
        { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/foo/bar.ts', content: 'x' } },
      ]),
      msg('assistant', [
        {
          type: 'tool_use',
          id: 't2',
          name: 'Edit',
          input: { file_path: '/foo/bar.ts', old_string: 'a', new_string: 'b' },
        },
      ]),
    ];
    expect(extractSessionFilePaths(messages)).toEqual(['/foo/bar.ts']);
  });

  it('ignores non-file tools like Bash, Grep', () => {
    const messages = [
      msg('assistant', [
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_use', id: 't2', name: 'Grep', input: { pattern: 'foo' } },
      ]),
    ];
    expect(extractSessionFilePaths(messages)).toEqual([]);
  });

  it('ignores tool_use blocks without file_path', () => {
    const messages = [msg('assistant', [{ type: 'tool_use', id: 't1', name: 'Write', input: {} }])];
    expect(extractSessionFilePaths(messages)).toEqual([]);
  });

  it('collects paths from subagent-injected tool_use blocks', () => {
    const messages = [
      msg('assistant', [
        { type: 'tool_use', id: 'agent1', name: 'Agent', input: { prompt: 'do work' } },
        // Injected by loadHistory merge logic:
        { type: 'tool_use', id: 'sub1', name: 'Write', input: { file_path: '/sub/file.ts', content: 'y' } },
      ]),
    ];
    expect(extractSessionFilePaths(messages)).toEqual(['/sub/file.ts']);
  });

  it('preserves insertion order', () => {
    const messages = [
      msg('assistant', [
        { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/b.ts', content: '' } },
        { type: 'tool_use', id: 't2', name: 'Write', input: { file_path: '/a.ts', content: '' } },
      ]),
    ];
    expect(extractSessionFilePaths(messages)).toEqual(['/b.ts', '/a.ts']);
  });
});
