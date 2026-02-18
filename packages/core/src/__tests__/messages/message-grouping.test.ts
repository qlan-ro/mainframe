import { describe, it, expect, beforeEach } from 'vitest';
import { groupMessages, type GroupedMessage } from '../../messages/message-grouping.js';
import type { ChatMessage, MessageContent } from '@mainframe/types';

/* ── helpers ─────────────────────────────────────────────────────── */

let idCounter = 0;
function resetIds() {
  idCounter = 0;
}

function msg(type: ChatMessage['type'], content: MessageContent[], overrides?: Partial<ChatMessage>): ChatMessage {
  idCounter++;
  return {
    id: overrides?.id ?? `msg-${idCounter}`,
    chatId: 'chat-1',
    type,
    content,
    timestamp: new Date(2026, 0, 1, 0, 0, idCounter).toISOString(),
    ...overrides,
  };
}

function textContent(t: string): MessageContent & { type: 'text' } {
  return { type: 'text', text: t };
}

function toolUseContent(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): MessageContent & { type: 'tool_use' } {
  return { type: 'tool_use', id, name, input };
}

function toolResultContent(
  toolUseId: string,
  content: string,
  isError = false,
): MessageContent & { type: 'tool_result' } {
  return { type: 'tool_result', toolUseId, content, isError };
}

/* ── tests ───────────────────────────────────────────────────────── */

describe('groupMessages', () => {
  beforeEach(resetIds);

  it('returns empty array for empty input', () => {
    expect(groupMessages([])).toEqual([]);
  });

  it('preserves a single user message as-is', () => {
    const messages = [msg('user', [textContent('hello')])];
    const result = groupMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('user');
    expect(result[0]!.content).toEqual([textContent('hello')]);
  });

  it('preserves a single assistant message as-is', () => {
    const messages = [msg('assistant', [textContent('hi there')])];
    const result = groupMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('assistant');
    expect(result[0]!.content).toEqual([textContent('hi there')]);
  });

  it('merges consecutive assistant messages into one turn', () => {
    const messages = [msg('assistant', [textContent('part 1')]), msg('assistant', [textContent('part 2')])];
    const result = groupMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toEqual([textContent('part 1'), textContent('part 2')]);
  });

  it('merges assistant followed by tool_use', () => {
    const messages = [
      msg('assistant', [textContent('thinking')]),
      msg('tool_use', [toolUseContent('tu1', 'Bash', { command: 'ls' })]),
    ];
    const result = groupMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toEqual([textContent('thinking'), toolUseContent('tu1', 'Bash', { command: 'ls' })]);
  });

  it('merges tool_use followed by assistant', () => {
    const messages = [msg('tool_use', [toolUseContent('tu1', 'Bash')]), msg('assistant', [textContent('result')])];
    const result = groupMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toEqual([toolUseContent('tu1', 'Bash'), textContent('result')]);
  });

  it('attaches tool_result to preceding assistant message', () => {
    const messages = [
      msg('assistant', [toolUseContent('tu1', 'Bash')]),
      msg('tool_result', [toolResultContent('tu1', 'output text')]),
    ];
    const result = groupMessages(messages);
    expect(result).toHaveLength(1);

    const grouped = result[0] as GroupedMessage;
    expect(grouped._toolResults).toBeDefined();
    expect(grouped._toolResults!.size).toBe(1);

    const tr = grouped._toolResults!.get('tu1')!;
    expect(tr.content).toBe('output text');
    expect(tr.isError).toBe(false);
  });

  it('attaches tool_result to preceding tool_use message', () => {
    const messages = [
      msg('tool_use', [toolUseContent('tu1', 'Read')]),
      msg('tool_result', [toolResultContent('tu1', 'file content')]),
    ];
    const result = groupMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!._toolResults!.has('tu1')).toBe(true);
  });

  it('attaches multiple tool_results to the same assistant turn', () => {
    const messages = [
      msg('assistant', [toolUseContent('tu1', 'Bash'), toolUseContent('tu2', 'Read')]),
      msg('tool_result', [toolResultContent('tu1', 'bash output'), toolResultContent('tu2', 'file content')]),
    ];
    const result = groupMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!._toolResults!.size).toBe(2);
    expect(result[0]!._toolResults!.get('tu1')!.content).toBe('bash output');
    expect(result[0]!._toolResults!.get('tu2')!.content).toBe('file content');
  });

  it('does not merge assistant after user', () => {
    const messages = [msg('user', [textContent('question')]), msg('assistant', [textContent('answer')])];
    const result = groupMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0]!.type).toBe('user');
    expect(result[1]!.type).toBe('assistant');
  });

  it('does not merge user after assistant', () => {
    const messages = [msg('assistant', [textContent('response')]), msg('user', [textContent('follow-up')])];
    const result = groupMessages(messages);
    expect(result).toHaveLength(2);
  });

  it('deduplicates tool_use blocks with the same id', () => {
    const messages = [
      msg('assistant', [
        toolUseContent('tu1', 'Bash', { command: 'ls' }),
        toolUseContent('tu1', 'Bash', { command: 'ls' }),
        toolUseContent('tu2', 'Read', { file: '/a.ts' }),
      ]),
    ];
    const result = groupMessages(messages);
    expect(result).toHaveLength(1);

    const toolUseBlocks = result[0]!.content.filter((c) => c.type === 'tool_use');
    expect(toolUseBlocks).toHaveLength(2);
    expect((toolUseBlocks[0] as MessageContent & { type: 'tool_use' }).id).toBe('tu1');
    expect((toolUseBlocks[1] as MessageContent & { type: 'tool_use' }).id).toBe('tu2');
  });

  it('deduplicates tool_use ids across merged messages', () => {
    const messages = [
      msg('assistant', [toolUseContent('tu1', 'Bash')]),
      msg('tool_use', [toolUseContent('tu1', 'Bash')]),
    ];
    const result = groupMessages(messages);
    expect(result).toHaveLength(1);

    const toolUseBlocks = result[0]!.content.filter((c) => c.type === 'tool_use');
    expect(toolUseBlocks).toHaveLength(1);
  });

  it('does not remove text blocks during deduplication', () => {
    const messages = [
      msg('assistant', [textContent('thinking'), toolUseContent('tu1', 'Bash'), textContent('more thinking')]),
    ];
    const result = groupMessages(messages);
    const textBlocks = result[0]!.content.filter((c) => c.type === 'text');
    expect(textBlocks).toHaveLength(2);
  });

  it('attaches turnDurationMs from system metadata marker to preceding assistant', () => {
    const messages = [
      msg('assistant', [textContent('answer')]),
      msg('system', [], { metadata: { turnDurationMs: 1234 } }),
    ];
    const result = groupMessages(messages);

    // system message is consumed (not in output)
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('assistant');
    expect(result[0]!.metadata?.turnDurationMs).toBe(1234);
  });

  it('attaches turnDurationMs to preceding tool_use when no assistant follows', () => {
    const messages = [
      msg('tool_use', [toolUseContent('tu1', 'Bash')]),
      msg('system', [], { metadata: { turnDurationMs: 500 } }),
    ];
    const result = groupMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.metadata?.turnDurationMs).toBe(500);
  });

  it('does not output the system turnDurationMs marker as a visible message', () => {
    const messages = [
      msg('user', [textContent('q')]),
      msg('assistant', [textContent('a')]),
      msg('system', [], { metadata: { turnDurationMs: 100 } }),
    ];
    const result = groupMessages(messages);
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.type !== 'system')).toBe(true);
  });

  it('passes through a system message without turnDurationMs', () => {
    const messages = [msg('system', [textContent('system init')])];
    const result = groupMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('system');
  });

  it('handles tool_result with no preceding assistant/tool_use (orphan)', () => {
    const messages = [
      msg('user', [textContent('question')]),
      msg('tool_result', [toolResultContent('tu1', 'orphan result')]),
    ];
    const result = groupMessages(messages);
    // tool_result cannot attach to user, so it is added as its own entry
    expect(result).toHaveLength(2);
  });

  it('preserves error messages', () => {
    const messages = [msg('error', [{ type: 'error', message: 'something broke' }])];
    const result = groupMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('error');
  });

  it('preserves permission messages', () => {
    const messages = [msg('permission', [{ type: 'permission_request', request: { tool: 'Bash' } as never }])];
    const result = groupMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('permission');
  });

  it('handles a complex conversation flow', () => {
    const messages = [
      msg('user', [textContent('fix the bug')]),
      msg('assistant', [textContent('Let me look')]),
      msg('tool_use', [toolUseContent('tu1', 'Read', { file: '/src/bug.ts' })]),
      msg('tool_result', [toolResultContent('tu1', 'buggy code here')]),
      msg('assistant', [textContent('Found it')]),
      msg('tool_use', [toolUseContent('tu2', 'Edit', { file: '/src/bug.ts' })]),
      msg('tool_result', [toolResultContent('tu2', 'edit applied')]),
      msg('assistant', [textContent('Fixed!')]),
    ];
    const result = groupMessages(messages);

    // user, merged(assistant+tool_use+tool_result+assistant+tool_use+tool_result+assistant)
    expect(result).toHaveLength(2);
    expect(result[0]!.type).toBe('user');
    expect(result[1]!.type).toBe('assistant');
    expect(result[1]!._toolResults?.size).toBe(2);
    expect(result[1]!._toolResults?.has('tu1')).toBe(true);
    expect(result[1]!._toolResults?.has('tu2')).toBe(true);
  });

  it('does not mutate original messages', () => {
    const original: ChatMessage = msg('assistant', [toolUseContent('tu1', 'Bash')]);
    const contentLengthBefore = original.content.length;
    groupMessages([original, msg('assistant', [textContent('more')])]);
    expect(original.content.length).toBe(contentLengthBefore);
  });
});
