import { describe, it, expect, beforeEach } from 'vitest';
import { prepareMessagesForClient } from '../../messages/display-pipeline.js';
import type { ChatMessage, MessageContent, ToolCategories } from '@qlan-ro/mainframe-types';

/* ── helpers ─────────────────────────────────────────────────────── */

let idCounter = 0;
function resetIds() {
  idCounter = 0;
}

function rawMsg(type: ChatMessage['type'], content: MessageContent[], overrides?: Partial<ChatMessage>): ChatMessage {
  idCounter++;
  return {
    id: `msg-${idCounter}`,
    chatId: 'chat-1',
    type,
    content,
    timestamp: new Date(2026, 0, 1, 0, 0, idCounter).toISOString(),
    ...overrides,
  };
}

const txt = (t: string): MessageContent & { type: 'text' } => ({ type: 'text', text: t });
const tu = (id: string, name: string, input: Record<string, unknown> = {}): MessageContent & { type: 'tool_use' } => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const tr = (toolUseId: string, content: string, isError = false): MessageContent & { type: 'tool_result' } => ({
  type: 'tool_result',
  toolUseId,
  content,
  isError,
});

const TEST_CATEGORIES: ToolCategories = {
  explore: new Set(['Read', 'Glob', 'Grep']),
  hidden: new Set(['TodoWrite', 'Skill']),
  progress: new Set(['TaskCreate', 'TaskUpdate']),
  subagent: new Set(['Task']),
};

/* ── tests ───────────────────────────────────────────────────────── */

describe('prepareMessagesForClient', () => {
  beforeEach(resetIds);

  it('returns empty array for empty input', () => {
    expect(prepareMessagesForClient([])).toEqual([]);
  });

  it('converts a single user text message', () => {
    const messages = [rawMsg('user', [txt('hello')])];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('user');
    expect(result[0]!.content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('converts a single assistant text message', () => {
    const messages = [rawMsg('assistant', [txt('hi there')])];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('assistant');
    expect(result[0]!.content).toEqual([{ type: 'text', text: 'hi there' }]);
  });

  it('converts assistant with tool_use + subsequent tool_result into tool_call with result', () => {
    const messages = [
      rawMsg('assistant', [txt('Let me check'), tu('tu1', 'Bash', { command: 'ls' })]),
      rawMsg('tool_result', [tr('tu1', 'file.ts\nindex.ts')]),
    ];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('assistant');

    const content = result[0]!.content;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: 'text', text: 'Let me check' });
    expect(content[1]).toMatchObject({
      type: 'tool_call',
      id: 'tu1',
      name: 'Bash',
      input: { command: 'ls' },
      category: 'default',
      result: { content: 'file.ts\nindex.ts', isError: false },
    });
  });

  it('merges consecutive assistant messages into one turn', () => {
    const messages = [rawMsg('assistant', [txt('part 1')]), rawMsg('assistant', [txt('part 2')])];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toEqual([
      { type: 'text', text: 'part 1' },
      { type: 'text', text: 'part 2' },
    ]);
  });

  it('strips mainframe-command-response tags from assistant text', () => {
    const messages = [
      rawMsg('assistant', [txt('<mainframe-command-response id="x">inner content</mainframe-command-response>')]),
    ];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.content[0]).toEqual({ type: 'text', text: 'inner content' });
  });

  it('filters out internal user messages with mainframe-command', () => {
    const messages = [
      rawMsg('user', [txt('<mainframe-command type="status">check</mainframe-command>')]),
      rawMsg('assistant', [txt('response')]),
    ];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('assistant');
  });

  it('renders user-typed /skill-name as a /skill-name bubble', () => {
    const messages = [
      rawMsg('user', [
        txt(
          '<command-message>systematic-debugging</command-message>\n<command-name>/systematic-debugging</command-name>',
        ),
      ]),
      rawMsg('assistant', [txt('response')]),
    ];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(2);
    expect(result[0]!.type).toBe('user');
    expect(result[0]!.content).toEqual([{ type: 'text', text: '/systematic-debugging' }]);
  });

  it('renders user-typed /skill-name with <command-args> as /skill-name args bubble', () => {
    const messages = [
      rawMsg('user', [
        txt(
          '<command-message>work-logger:slack-status-writer</command-message>\n<command-name>/work-logger:slack-status-writer</command-name>\n<command-args>how are you</command-args>',
        ),
      ]),
    ];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('user');
    expect(result[0]!.content).toEqual([{ type: 'text', text: '/work-logger:slack-status-writer how are you' }]);
  });

  it('deduplicates tool_use blocks by id (keeps first occurrence)', () => {
    const messages = [
      rawMsg('assistant', [
        tu('tu1', 'Bash', { command: 'ls' }),
        tu('tu1', 'Bash', { command: 'ls' }),
        tu('tu2', 'Read', { file: '/a.ts' }),
      ]),
    ];
    const result = prepareMessagesForClient(messages);
    const toolCalls = result[0]!.content.filter((c) => c.type === 'tool_call');
    expect(toolCalls).toHaveLength(2);
  });

  it('passes through system compact_boundary as system DisplayMessage', () => {
    const messages = [rawMsg('system', [txt('[compact_boundary]')])];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('system');
    expect(result[0]!.content).toEqual([{ type: 'text', text: '[compact_boundary]' }]);
  });

  it('deduplicates messages with the same id (keeps first occurrence)', () => {
    const messages = [
      rawMsg('user', [txt('hello')]),
      rawMsg('assistant', [txt('hi')]),
      rawMsg('system', [txt('Context compacted')], { id: 'dup-id' }),
      rawMsg('user', [txt('more')]),
      rawMsg('system', [txt('Context compacted')], { id: 'dup-id' }),
    ];
    const result = prepareMessagesForClient(messages);
    const systemMsgs = result.filter((m) => m.type === 'system');
    expect(systemMsgs).toHaveLength(1);
    expect(result.map((m) => m.id)).not.toContain(undefined);
    // Total should be 4 (user, assistant, system, user) — second system deduplicated
    expect(result).toHaveLength(4);
  });

  it('passes through error messages', () => {
    const messages = [rawMsg('error', [{ type: 'error', message: 'something broke' }])];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('error');
    expect(result[0]!.content).toEqual([{ type: 'error', message: 'something broke' }]);
  });

  it('attaches turnDurationMs to preceding assistant and omits system msg', () => {
    const messages = [
      rawMsg('assistant', [txt('answer')]),
      rawMsg('system', [], { metadata: { turnDurationMs: 1234 } }),
    ];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('assistant');
    expect(result[0]!.metadata?.turnDurationMs).toBe(1234);
  });

  it('applies tool categories: explore tool gets explore category', () => {
    const messages = [
      rawMsg('assistant', [tu('tu1', 'Read', { file: '/a.ts' })]),
      rawMsg('tool_result', [tr('tu1', 'content')]),
    ];
    const result = prepareMessagesForClient(messages, TEST_CATEGORIES);
    const tc = result[0]!.content.find((c) => c.type === 'tool_call');
    expect(tc).toMatchObject({ type: 'tool_call', category: 'explore' });
  });

  it('passes through permission messages', () => {
    const request = { tool: 'Bash', type: 'tool' };
    const messages = [rawMsg('permission', [{ type: 'permission_request', request: request as never }])];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('permission');
    expect(result[0]!.content[0]).toMatchObject({ type: 'permission_request' });
  });

  it('filters [Request interrupted text from user messages', () => {
    const messages = [rawMsg('user', [txt('fix the bug'), txt('[Request interrupted by user]')])];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toEqual([{ type: 'text', text: 'fix the bug' }]);
  });

  it('populates metadata.attachedFiles for file path tags in user messages', () => {
    const messages = [rawMsg('user', [txt('check this <attached_file_path name="foo.ts"/>')])];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.metadata?.attachedFiles).toEqual([{ name: 'foo.ts' }]);
    // Text should have the tag stripped
    expect((result[0]!.content[0] as { type: 'text'; text: string }).text).toBe('check this');
  });

  it('does not mutate original messages', () => {
    const original: ChatMessage = rawMsg('assistant', [tu('tu1', 'Bash', { command: 'ls' })]);
    const contentBefore = [...original.content];
    const metaBefore = original.metadata;

    prepareMessagesForClient([
      original,
      rawMsg('assistant', [txt('more')]),
      rawMsg('tool_result', [tr('tu1', 'output')]),
      rawMsg('system', [], { metadata: { turnDurationMs: 100 } }),
    ]);

    expect(original.content).toEqual(contentBefore);
    expect(original.metadata).toBe(metaBefore);
  });

  it('keeps thinking blocks as-is in assistant messages', () => {
    const messages = [rawMsg('assistant', [{ type: 'thinking', thinking: 'let me think...' }, txt('response')])];
    const result = prepareMessagesForClient(messages);
    expect(result[0]!.content[0]).toEqual({ type: 'thinking', thinking: 'let me think...' });
    expect(result[0]!.content[1]).toEqual({ type: 'text', text: 'response' });
  });

  it('keeps image blocks in assistant messages', () => {
    const messages = [
      rawMsg('assistant', [txt('here is your image'), { type: 'image', mediaType: 'image/png', data: 'pngbase64' }]),
    ];
    const result = prepareMessagesForClient(messages);
    expect(result[0]!.content).toHaveLength(2);
    expect(result[0]!.content[1]).toEqual({
      type: 'image',
      mediaType: 'image/png',
      data: 'pngbase64',
    });
  });

  it('keeps image blocks in user messages', () => {
    const messages = [
      rawMsg('user', [txt('look at this'), { type: 'image', mediaType: 'image/png', data: 'base64data' }]),
    ];
    const result = prepareMessagesForClient(messages);
    expect(result[0]!.content).toHaveLength(2);
    expect(result[0]!.content[1]).toEqual({
      type: 'image',
      mediaType: 'image/png',
      data: 'base64data',
    });
  });

  it('suppresses orphan tool_result (not attached to assistant)', () => {
    const messages = [rawMsg('user', [txt('question')]), rawMsg('tool_result', [tr('tu1', 'orphan result')])];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('user');
  });

  it('suppresses a bare <command-name> message with no body (subagent/replay echo)', () => {
    // Subagent CLI echoes emit <command-name>skill</command-name> with no <command-message>
    // and no other content. These are internal CLI metadata and must not produce a visible bubble.
    const messages = [
      rawMsg('user', [txt('<command-name>do-thing</command-name>')]),
      rawMsg('assistant', [txt('response')]),
    ];
    const result = prepareMessagesForClient(messages);
    // The bare <command-name> message must be suppressed; only the assistant reply remains
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('assistant');
  });

  it('suppresses a <command-name> with empty body after stripping (replay path with no visible text)', () => {
    // Replay path: <command-name> only, no command-message, no args, no body
    const messages = [rawMsg('user', [txt('<command-name>/some-internal-skill</command-name>')])];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(0);
  });

  it('still renders user-typed /skill-name that has <command-message> alongside <command-name>', () => {
    // User-typed slash commands always arrive with both <command-message> and <command-name>
    const messages = [
      rawMsg('user', [
        txt(
          '<command-message>systematic-debugging</command-message>\n<command-name>/systematic-debugging</command-name>',
        ),
      ]),
      rawMsg('assistant', [txt('response')]),
    ];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(2);
    expect(result[0]!.type).toBe('user');
    expect(result[0]!.content).toEqual([{ type: 'text', text: '/systematic-debugging' }]);
  });

  it('still renders user-typed /skill-name args bubble when <command-message> is present', () => {
    const messages = [
      rawMsg('user', [
        txt(
          '<command-message>brainstorming</command-message>\n<command-name>/brainstorming</command-name>\n<command-args>new feature idea</command-args>',
        ),
      ]),
    ];
    const result = prepareMessagesForClient(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('user');
    expect(result[0]!.content).toEqual([{ type: 'text', text: '/brainstorming new feature idea' }]);
  });

  describe('tool grouping with categories', () => {
    it('groups consecutive explore tools into a tool_group', () => {
      const messages = [
        rawMsg('assistant', [
          tu('tu1', 'Read', { file: '/a.ts' }),
          tu('tu2', 'Grep', { pattern: 'foo' }),
          tu('tu3', 'Glob', { pattern: '*.ts' }),
        ]),
        rawMsg('tool_result', [tr('tu1', 'a-content'), tr('tu2', 'grep-result'), tr('tu3', 'glob-result')]),
      ];
      const result = prepareMessagesForClient(messages, TEST_CATEGORIES);
      const groups = result[0]!.content.filter((c) => c.type === 'tool_group');
      expect(groups).toHaveLength(1);
    });

    it('wraps subagent tool + children into a task_group', () => {
      const messages = [
        rawMsg('assistant', [tu('tu1', 'Task', { description: 'do something' }), tu('tu2', 'Bash', { command: 'ls' })]),
        rawMsg('tool_result', [tr('tu1', 'task-result'), tr('tu2', 'bash-result')]),
      ];
      const result = prepareMessagesForClient(messages, TEST_CATEGORIES);
      const taskGroups = result[0]!.content.filter((c) => c.type === 'task_group');
      expect(taskGroups).toHaveLength(1);
    });

    it('preserves thinking block position among grouped tool calls', () => {
      // thinking appears between text and tool calls — should stay in order
      const messages = [
        rawMsg('assistant', [
          txt('Let me think'),
          { type: 'thinking', thinking: 'reasoning here' } as MessageContent,
          tu('tu1', 'Read', { file_path: 'a.ts' }),
          tu('tu2', 'Read', { file_path: 'b.ts' }),
          tu('tu3', 'Bash', { command: 'ls' }),
        ]),
        rawMsg('tool_result', [tr('tu1', 'content-a'), tr('tu2', 'content-b'), tr('tu3', 'ls-output')]),
      ];
      const result = prepareMessagesForClient(messages, TEST_CATEGORIES);
      const content = result[0]!.content;
      const types = content.map((c) => c.type);

      // thinking should appear between text and tool entries, not at the front or back
      const thinkingIdx = types.indexOf('thinking');
      const textIdx = types.indexOf('text');
      expect(thinkingIdx).toBeGreaterThan(textIdx);
      // Should NOT be pushed to front (the old bug)
      expect(thinkingIdx).not.toBe(0);
    });
  });
});
