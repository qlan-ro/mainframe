import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@qlan-ro/mainframe-types';
import { extractSessionDiffs } from '../../messages/session-diffs.js';

function msg(role: 'assistant' | 'user', content: any[]): ChatMessage {
  return { id: `msg-${Math.random()}`, chatId: 'c1', role, content, timestamp: new Date().toISOString() };
}

describe('extractSessionDiffs', () => {
  it('returns empty array for empty messages', () => {
    expect(extractSessionDiffs([])).toEqual([]);
  });

  it('returns empty array when no Write/Edit tool calls exist', () => {
    const messages = [
      msg('assistant', [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }]),
      msg('user', [{ type: 'tool_result', toolUseId: 'tu1', content: 'output', isError: false }]),
    ];
    expect(extractSessionDiffs(messages)).toEqual([]);
  });

  it('returns added status for new file (Write with no originalFile)', () => {
    const messages = [
      msg('assistant', [{ type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: '/src/new.ts' } }]),
      msg('user', [
        { type: 'tool_result', toolUseId: 'tu1', content: 'ok', isError: false, modifiedFile: 'new content' },
      ]),
    ];
    const result = extractSessionDiffs(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      filePath: '/src/new.ts',
      original: null,
      modified: 'new content',
      status: 'added',
    });
  });

  it('returns modified status for edited file (Edit with originalFile)', () => {
    const messages = [
      msg('assistant', [{ type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: '/src/existing.ts' } }]),
      msg('user', [
        {
          type: 'tool_result',
          toolUseId: 'tu1',
          content: 'ok',
          isError: false,
          originalFile: 'old content',
          modifiedFile: 'new content',
        },
      ]),
    ];
    const result = extractSessionDiffs(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      filePath: '/src/existing.ts',
      original: 'old content',
      modified: 'new content',
      status: 'modified',
    });
  });

  it('tracks first original and last modified for multiple edits to same file', () => {
    const messages = [
      msg('assistant', [{ type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: '/src/foo.ts' } }]),
      msg('user', [
        {
          type: 'tool_result',
          toolUseId: 'tu1',
          content: 'ok',
          isError: false,
          originalFile: 'original v1',
          modifiedFile: 'modified v1',
        },
      ]),
      msg('assistant', [{ type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/src/foo.ts' } }]),
      msg('user', [
        {
          type: 'tool_result',
          toolUseId: 'tu2',
          content: 'ok',
          isError: false,
          originalFile: 'modified v1',
          modifiedFile: 'modified v2',
        },
      ]),
    ];
    const result = extractSessionDiffs(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      filePath: '/src/foo.ts',
      original: 'original v1',
      modified: 'modified v2',
      status: 'modified',
    });
  });

  it('handles multiple files in the same message', () => {
    const messages = [
      msg('assistant', [
        { type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: '/src/a.ts' } },
        { type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/src/b.ts' } },
      ]),
      msg('user', [
        { type: 'tool_result', toolUseId: 'tu1', content: 'ok', isError: false, modifiedFile: 'a content' },
        {
          type: 'tool_result',
          toolUseId: 'tu2',
          content: 'ok',
          isError: false,
          originalFile: 'b original',
          modifiedFile: 'b content',
        },
      ]),
    ];
    const result = extractSessionDiffs(messages);
    expect(result).toHaveLength(2);

    const a = result.find((r) => r.filePath === '/src/a.ts');
    expect(a).toEqual({ filePath: '/src/a.ts', original: null, modified: 'a content', status: 'added' });

    const b = result.find((r) => r.filePath === '/src/b.ts');
    expect(b).toEqual({ filePath: '/src/b.ts', original: 'b original', modified: 'b content', status: 'modified' });
  });

  it('skips tool_result with isError: true', () => {
    const messages = [
      msg('assistant', [{ type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: '/src/fail.ts' } }]),
      msg('user', [
        { type: 'tool_result', toolUseId: 'tu1', content: 'error', isError: true, modifiedFile: 'bad content' },
      ]),
    ];
    expect(extractSessionDiffs(messages)).toEqual([]);
  });

  it('skips tool_result without modifiedFile', () => {
    const messages = [
      msg('assistant', [{ type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: '/src/noop.ts' } }]),
      msg('user', [{ type: 'tool_result', toolUseId: 'tu1', content: 'ok', isError: false }]),
    ];
    expect(extractSessionDiffs(messages)).toEqual([]);
  });

  it('ignores tool_use without file_path input', () => {
    const messages = [
      msg('assistant', [{ type: 'tool_use', id: 'tu1', name: 'Write', input: {} }]),
      msg('user', [{ type: 'tool_result', toolUseId: 'tu1', content: 'ok', isError: false, modifiedFile: 'content' }]),
    ];
    expect(extractSessionDiffs(messages)).toEqual([]);
  });
});
