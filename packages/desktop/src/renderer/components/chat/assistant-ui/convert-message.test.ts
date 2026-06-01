import { describe, it, expect } from 'vitest';
import { convertMessage, PERMISSION_PLACEHOLDER } from './convert-message';
import type { DisplayMessage, DisplayContent } from '@qlan-ro/mainframe-types';

/* ── helpers ─────────────────────────────────────────────────────── */

function display(
  type: DisplayMessage['type'],
  content: DisplayContent[],
  overrides?: Partial<DisplayMessage>,
): DisplayMessage {
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    type,
    content,
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/* ── sentinel placeholders ───────────────────────────────────────── */

describe('sentinel placeholders', () => {
  it('PERMISSION_PLACEHOLDER has null-byte prefix', () => {
    expect(PERMISSION_PLACEHOLDER.text).toBe('\0__MF_PERMISSION__');
    expect(PERMISSION_PLACEHOLDER.type).toBe('text');
  });

  it('PERMISSION_PLACEHOLDER is frozen', () => {
    expect(Object.isFrozen(PERMISSION_PLACEHOLDER)).toBe(true);
  });
});

/* ── convertMessage ──────────────────────────────────────────────── */

describe('convertMessage', () => {
  describe('user messages', () => {
    it('converts a user message with text', () => {
      const msg = display('user', [{ type: 'text', text: 'hello' }]);
      const result = convertMessage(msg);

      expect(result.role).toBe('user');
      expect(result.id).toBe('msg-1');
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.content).toEqual([{ type: 'text', text: 'hello' }]);
    });

    it('converts a user message with multiple text blocks', () => {
      const msg = display('user', [
        { type: 'text', text: 'line 1' },
        { type: 'text', text: 'line 2' },
      ]);
      const result = convertMessage(msg);
      expect(result.content).toEqual([
        { type: 'text', text: 'line 1' },
        { type: 'text', text: 'line 2' },
      ]);
    });

    it('produces a fallback empty text for user message with no text content', () => {
      const msg = display('user', [{ type: 'image', mediaType: 'image/png', data: 'base64...' }]);
      const result = convertMessage(msg);
      expect(result.content).toEqual([{ type: 'text', text: '' }]);
    });

    it('filters out non-text blocks from user messages', () => {
      const msg = display('user', [
        { type: 'text', text: 'visible' },
        { type: 'image', mediaType: 'image/png', data: 'data' },
      ]);
      const result = convertMessage(msg);
      expect(result.content).toEqual([{ type: 'text', text: 'visible' }]);
    });

    it('skips empty text blocks in user messages', () => {
      const msg = display('user', [
        { type: 'text', text: '' },
        { type: 'text', text: 'real text' },
      ]);
      const result = convertMessage(msg);
      expect(result.content).toEqual([{ type: 'text', text: 'real text' }]);
    });
  });

  describe('system messages', () => {
    it('converts a system message with text', () => {
      const msg = display('system', [{ type: 'text', text: 'system init' }]);
      const result = convertMessage(msg);

      expect(result.role).toBe('system');
      expect(result.content).toEqual([{ type: 'text', text: 'system init' }]);
    });

    it('filters out non-text content from system messages', () => {
      const msg = display('system', [
        { type: 'text', text: 'keep this' },
        // tool_call is not a valid system content but we test filtering
        { type: 'error', message: 'drop this' },
      ]);
      const result = convertMessage(msg);
      expect(result.content).toEqual([{ type: 'text', text: 'keep this' }]);
    });
  });

  describe('assistant messages', () => {
    it('converts an assistant message with text', () => {
      const msg = display('assistant', [{ type: 'text', text: 'I can help' }]);
      const result = convertMessage(msg);

      expect(result.role).toBe('assistant');
      expect(result.content).toEqual([{ type: 'text', text: 'I can help' }]);
    });

    it('converts thinking blocks to reasoning parts', () => {
      const msg = display('assistant', [{ type: 'thinking', thinking: 'Let me think...' }]);
      const result = convertMessage(msg);
      expect(result.content).toEqual([{ type: 'reasoning', text: 'Let me think...' }]);
    });

    it('converts tool_call blocks to tool-call parts', () => {
      const msg = display('assistant', [
        { type: 'tool_call', id: 'tu1', name: 'Bash', input: { command: 'ls' }, category: 'default' },
      ]);
      const result = convertMessage(msg);
      expect(result.content).toHaveLength(1);

      const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
      expect(part.type).toBe('tool-call');
      expect(part.toolCallId).toBe('tu1');
      expect(part.toolName).toBe('Bash');
      expect(part.args).toEqual({ command: 'ls' });
      expect(part.result).toBeUndefined();
    });

    it('attaches tool result data from tool_call result field', () => {
      const msg = display('assistant', [
        {
          type: 'tool_call',
          id: 'tu1',
          name: 'Bash',
          input: {},
          category: 'default',
          result: { content: 'command output', isError: false },
        },
      ]);
      const result = convertMessage(msg);
      const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
      expect(part.result).toBe('command output');
      expect(part.isError).toBe(false);
    });

    it('attaches structured patch data from tool results', () => {
      const patch = [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: ['+new'] }];
      const msg = display('assistant', [
        {
          type: 'tool_call',
          id: 'tu1',
          name: 'Edit',
          input: {},
          category: 'default',
          result: {
            content: 'diff applied',
            isError: false,
            structuredPatch: patch,
            originalFile: 'original',
            modifiedFile: 'modified',
          },
        },
      ]);
      const result = convertMessage(msg);
      const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
      expect(part.result).toEqual({
        content: 'diff applied',
        structuredPatch: patch,
        originalFile: 'original',
        modifiedFile: 'modified',
      });
    });

    it('preserves askUserQuestion on AskUserQuestion tool results', () => {
      const answers = [
        { question: 'Q with "quotes"?', answer: ['Free, text, with commas'] },
        { question: 'Q2?', answer: ['A2'] },
      ];
      const msg = display('assistant', [
        {
          type: 'tool_call',
          id: 'tu1',
          name: 'AskUserQuestion',
          input: { questions: [{ question: 'Q with "quotes"?' }, { question: 'Q2?' }] },
          category: 'default',
          result: { content: 'User has answered your questions: ...', isError: false, askUserQuestion: answers },
        },
      ]);
      const result = convertMessage(msg);
      const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
      expect(part.result).toEqual({
        content: 'User has answered your questions: ...',
        askUserQuestion: answers,
      });
    });

    it('carries error block message text directly in the text part (no sentinel)', () => {
      const msg = display('assistant', [{ type: 'error', message: 'something went wrong' }]);
      const result = convertMessage(msg);
      expect(result.content).toHaveLength(1);
      const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
      expect(part.type).toBe('text');
      expect(part.text).toBe('something went wrong');
    });

    it('converts permission_request blocks to PERMISSION_PLACEHOLDER', () => {
      const msg = display('assistant', [
        {
          type: 'permission_request',
          request: { requestId: 'req-1', toolName: 'Bash', toolUseId: 'tu-1', input: {}, suggestions: [] },
        },
      ]);
      const result = convertMessage(msg);
      expect(result.content).toHaveLength(1);
      expect((result.content as unknown as Array<Record<string, unknown>>)[0]).toBe(PERMISSION_PLACEHOLDER);
    });

    it('produces a fallback empty text for assistant message with no content', () => {
      const msg = display('assistant', []);
      const result = convertMessage(msg);
      expect(result.content).toEqual([{ type: 'text', text: '' }]);
    });

    it('maps tool_group blocks to _ToolGroup tool-call parts', () => {
      const msg = display('assistant', [
        {
          type: 'tool_group',
          calls: [
            { type: 'tool_call', id: 'tu1', name: 'Read', input: { file: '/a.ts' }, category: 'explore' },
            { type: 'tool_call', id: 'tu2', name: 'Grep', input: { pattern: 'foo' }, category: 'explore' },
          ],
        },
      ]);
      const result = convertMessage(msg);
      expect(result.content).toHaveLength(1);
      const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
      expect(part.type).toBe('tool-call');
      expect(part.toolName).toBe('_ToolGroup');
      const args = part.args as Record<string, unknown>;
      const items = args.items as Array<Record<string, unknown>>;
      expect(items).toHaveLength(2);
      expect(items[0]!.toolName).toBe('Read');
      expect(items[1]!.toolName).toBe('Grep');
    });

    it('maps task_group blocks to _TaskGroup tool-call parts', () => {
      const msg = display('assistant', [
        {
          type: 'task_group',
          agentId: 'agent-1',
          taskArgs: { description: 'do work' },
          calls: [
            { type: 'tool_call', id: 'tu1', name: 'Task', input: { description: 'do work' }, category: 'subagent' },
            { type: 'tool_call', id: 'tu2', name: 'Bash', input: { command: 'ls' }, category: 'default' },
          ],
        },
      ]);
      const result = convertMessage(msg);
      expect(result.content).toHaveLength(1);
      const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
      expect(part.type).toBe('tool-call');
      expect(part.toolCallId).toBe('agent-1');
      expect(part.toolName).toBe('_TaskGroup');
    });

    it('re-encodes nested tool_group children inside a task_group as _ToolGroup tool children', () => {
      // A subagent that runs >=2 consecutive explore tools produces a nested
      // first-class tool_group inside task_group.calls (see core
      // applyToolGrouping characterization). TaskGroupCard renders + summarizes
      // children whose toolName is '_ToolGroup'; if convertMessage drops the
      // nested tool_group, the subagent's file reads/greps vanish from the card.
      const msg = display('assistant', [
        {
          type: 'task_group',
          agentId: 'agent-1',
          taskArgs: { description: 'do work' },
          calls: [
            {
              type: 'tool_group',
              calls: [
                { type: 'tool_call', id: 'c1', name: 'Read', input: { file: '/a.ts' }, category: 'explore' },
                { type: 'tool_call', id: 'c2', name: 'Grep', input: { pattern: 'x' }, category: 'explore' },
              ],
            },
          ],
        },
      ]);
      const result = convertMessage(msg);
      const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
      const children = (part.args as Record<string, unknown>).children as Array<Record<string, unknown>>;
      expect(children).toHaveLength(1);
      expect(children[0]!.kind).toBe('tool');
      expect(children[0]!.toolName).toBe('_ToolGroup');
      const items = (children[0]!.args as Record<string, unknown>).items as Array<Record<string, unknown>>;
      expect(items.map((i) => i.toolName)).toEqual(['Read', 'Grep']);
    });

    it('re-encodes nested task_progress children inside a task_group as _TaskProgress tool children', () => {
      const msg = display('assistant', [
        {
          type: 'task_group',
          agentId: 'agent-1',
          taskArgs: { description: 'do work' },
          calls: [
            {
              type: 'task_progress',
              items: [
                { id: 'p1', name: 'TodoWrite', input: {}, category: 'progress' },
                { id: 'p2', name: 'TodoWrite', input: {}, category: 'progress' },
              ],
            },
          ],
        },
      ]);
      const result = convertMessage(msg);
      const part = (result.content as unknown as Array<Record<string, unknown>>)[0]!;
      const children = (part.args as Record<string, unknown>).children as Array<Record<string, unknown>>;
      expect(children).toHaveLength(1);
      expect(children[0]!.kind).toBe('tool');
      expect(children[0]!.toolName).toBe('_TaskProgress');
      const items = (children[0]!.args as Record<string, unknown>).items as Array<Record<string, unknown>>;
      expect(items).toHaveLength(2);
    });

    it('de-duplicates colliding toolCallIds across task_group blocks (regression: #184)', () => {
      // Two CollabAgent spawns in one turn whose role/description collapsed to the same
      // agentId crashed assistant-ui with "Duplicate key toolCallId-default in tapResources".
      // The defensive dedup in convertMessage rewrites the second occurrence so the
      // renderer can key both parts independently.
      const msg = display('assistant', [
        {
          type: 'task_group',
          agentId: 'default',
          taskArgs: { description: 'default' },
          calls: [{ type: 'tool_call', id: 'tu1', name: 'CollabAgent', input: {}, category: 'subagent' }],
        },
        {
          type: 'task_group',
          agentId: 'default',
          taskArgs: { description: 'default' },
          calls: [{ type: 'tool_call', id: 'tu2', name: 'CollabAgent', input: {}, category: 'subagent' }],
        },
      ]);
      const result = convertMessage(msg);
      const ids = (result.content as unknown as Array<Record<string, unknown>>).map((p) => p.toolCallId);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
    });

    it('substitutes a non-empty toolCallId when an empty id would be emitted (regression: #184)', () => {
      // _ToolGroup falls back to '' if the first call has no id. Two such groups in one
      // message used to collide on the empty key.
      const msg = display('assistant', [
        {
          type: 'tool_group',
          calls: [{ type: 'tool_call', id: '', name: 'Read', input: {}, category: 'explore' }],
        },
        {
          type: 'tool_group',
          calls: [{ type: 'tool_call', id: '', name: 'Grep', input: {}, category: 'explore' }],
        },
      ]);
      const result = convertMessage(msg);
      const ids = (result.content as unknown as Array<Record<string, unknown>>).map((p) => p.toolCallId);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
      expect(ids.every((id) => typeof id === 'string' && (id as string).length > 0)).toBe(true);
    });

    it('skips image blocks in assistant messages (rendered directly from original DisplayMessage)', () => {
      const msg = display('assistant', [
        { type: 'text', text: 'Here is a screenshot:' },
        { type: 'image', mediaType: 'image/png', data: 'base64data==' },
      ]);
      const result = convertMessage(msg);
      // Only the text part should appear; the image block is intentionally excluded
      // from the ThreadMessageLike content — it is accessed directly from the original
      // DisplayMessage by AssistantMessage via getExternalStoreMessages.
      expect(result.content).toEqual([{ type: 'text', text: 'Here is a screenshot:' }]);
    });

    it('produces fallback empty text when assistant message has only image blocks', () => {
      const msg = display('assistant', [{ type: 'image', mediaType: 'image/jpeg', data: 'abc' }]);
      const result = convertMessage(msg);
      // No text/tool parts → fallback empty text (image is rendered separately)
      expect(result.content).toEqual([{ type: 'text', text: '' }]);
    });

    it('handles mixed content: text, thinking, tool_call, error', () => {
      const msg = display('assistant', [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: 'Let me check' },
        { type: 'tool_call', id: 'tu1', name: 'Bash', input: {}, category: 'default' },
        { type: 'error', message: 'oops' },
      ]);
      const result = convertMessage(msg);

      const types = (result.content as unknown as Array<Record<string, unknown>>).map((p) => p.type);
      expect(types).toEqual(['reasoning', 'text', 'tool-call', 'text']);

      // The last part carries the actual error message text (no sentinel)
      const last = (result.content as unknown as Array<Record<string, unknown>>)[3]!;
      expect(last.type).toBe('text');
      expect(last.text).toBe('oops');
    });
  });

  describe('error messages', () => {
    it('converts error type messages to assistant role carrying the error message text', () => {
      const msg = display('error', [{ type: 'error', message: 'crash' }]);
      const result = convertMessage(msg);

      expect(result.role).toBe('assistant');
      const parts = result.content as unknown as Array<Record<string, unknown>>;
      expect(parts).toHaveLength(1);
      expect(parts[0]!.type).toBe('text');
      expect(parts[0]!.text).toBe('crash');
    });

    it('falls back to default message when error block is missing', () => {
      // error type message with no error block in content
      const msg = display('error', []);
      const result = convertMessage(msg);

      expect(result.role).toBe('assistant');
      const parts = result.content as unknown as Array<Record<string, unknown>>;
      expect(parts[0]!.text).toBe('An error occurred');
    });

    it('falls back to default message when the error block message is empty or whitespace-only', () => {
      // An empty or whitespace-only error string must not collapse to a blank
      // text part — MainframeText drops blank-after-trim text before its error
      // check, which would hide the error bubble entirely.
      for (const blank of ['', '   ', '\n\t']) {
        const msg = display('error', [{ type: 'error', message: blank }]);
        const parts = convertMessage(msg).content as unknown as Array<Record<string, unknown>>;
        expect(parts[0]!.text).toBe('An error occurred');
      }
    });
  });

  describe('permission messages', () => {
    it('converts permission type messages to assistant role with PERMISSION_PLACEHOLDER', () => {
      const msg = display('permission', [
        {
          type: 'permission_request',
          request: { requestId: 'req-1', toolName: 'Bash', toolUseId: 'tu-1', input: {}, suggestions: [] },
        },
      ]);
      const result = convertMessage(msg);

      expect(result.role).toBe('assistant');
      expect(result.content).toEqual([PERMISSION_PLACEHOLDER]);
    });
  });

  describe('unknown/default message types', () => {
    it('converts unknown types to assistant with empty text', () => {
      const unknownMsg = { ...display('user', []), type: 'unknown' as DisplayMessage['type'] };
      const result = convertMessage(unknownMsg);

      expect(result.role).toBe('assistant');
      expect(result.content).toEqual([{ type: 'text', text: '' }]);
    });
  });

  describe('metadata preservation', () => {
    it('sets createdAt from message timestamp', () => {
      const msg = display('user', [{ type: 'text', text: 'hi' }], {
        timestamp: '2026-06-15T12:30:00.000Z',
      });
      const result = convertMessage(msg);
      expect(result.createdAt).toEqual(new Date('2026-06-15T12:30:00.000Z'));
    });

    it('sets id from message id', () => {
      const msg = display('user', [{ type: 'text', text: 'hi' }], { id: 'custom-id' });
      const result = convertMessage(msg);
      expect(result.id).toBe('custom-id');
    });
  });
});
