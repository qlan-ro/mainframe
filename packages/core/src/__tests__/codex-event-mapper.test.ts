// packages/core/src/__tests__/codex-event-mapper.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleNotification } from '../plugins/builtin/codex/event-mapper.js';
import type { SessionSink } from '@qlan-ro/mainframe-types';
import type { CodexSessionState } from '../plugins/builtin/codex/event-mapper.js';

function createSink(): SessionSink {
  return {
    onInit: vi.fn(),
    onMessage: vi.fn(),
    onToolResult: vi.fn(),
    onPermission: vi.fn(),
    onResult: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    onCompact: vi.fn(),
    onCompactStart: vi.fn(),
    onContextUsage: vi.fn(),
    onPlanFile: vi.fn(),
    onSkillFile: vi.fn(),
    onQueuedProcessed: vi.fn(),
    onTodoUpdate: vi.fn(),
    onPrDetected: vi.fn(),
    onCliMessage: vi.fn(),
    onSkillLoaded: vi.fn(),
  };
}

function createState(): CodexSessionState {
  return { threadId: null, currentTurnId: null, currentTurnPlan: null };
}

describe('handleNotification', () => {
  it('thread/started sets threadId and calls onInit', () => {
    const sink = createSink();
    const state = createState();
    handleNotification('thread/started', { thread: { id: 'thr_abc' } }, sink, state);
    expect(sink.onInit).toHaveBeenCalledWith('thr_abc');
    expect(state.threadId).toBe('thr_abc');
  });

  it('turn/started stores currentTurnId', () => {
    const sink = createSink();
    const state = createState();
    handleNotification('turn/started', { threadId: 't1', turn: { id: 'turn_1' } }, sink, state);
    expect(state.currentTurnId).toBe('turn_1');
  });

  it('item/completed agentMessage calls onMessage with text', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: { id: 'item_1', type: 'agentMessage', text: 'Hello world' },
      },
      sink,
      state,
    );
    expect(sink.onMessage).toHaveBeenCalledWith([{ type: 'text', text: 'Hello world' }]);
  });

  it('item/completed reasoning calls onMessage with thinking', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: { id: 'item_1', type: 'reasoning', summary: ['Let me think...'], content: ['details'] },
      },
      sink,
      state,
    );
    expect(sink.onMessage).toHaveBeenCalledWith([{ type: 'thinking', thinking: 'Let me think...' }]);
  });

  it('item/completed commandExecution emits Bash tool_use + tool_result (exitCode 0)', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: {
          id: 'item_1',
          type: 'commandExecution',
          command: 'ls -la',
          aggregatedOutput: 'file.txt\n',
          exitCode: 0,
          status: 'completed',
        },
      },
      sink,
      state,
    );
    expect(sink.onMessage).toHaveBeenCalledWith([
      {
        type: 'tool_use',
        id: 'item_1',
        name: 'Bash',
        input: { command: 'ls -la' },
      },
    ]);
    expect(sink.onToolResult).toHaveBeenCalledWith([
      {
        type: 'tool_result',
        toolUseId: 'item_1',
        content: 'file.txt\n',
        isError: false,
      },
    ]);
  });

  it('item/completed commandExecution with exitCode 1 sets isError true', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: {
          id: 'item_1',
          type: 'commandExecution',
          command: 'false',
          aggregatedOutput: '',
          exitCode: 1,
          status: 'failed',
        },
      },
      sink,
      state,
    );
    expect(sink.onToolResult).toHaveBeenCalledWith([expect.objectContaining({ isError: true })]);
  });

  it('item/completed commandExecution with undefined exitCode treats as success (isError false)', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: {
          id: 'item_1',
          type: 'commandExecution',
          command: 'echo hello',
          aggregatedOutput: 'hello\n',
          // exitCode intentionally omitted
          status: 'completed',
        },
      },
      sink,
      state,
    );
    expect(sink.onToolResult).toHaveBeenCalledWith([expect.objectContaining({ isError: false })]);
  });

  it('item/completed fileChange (add) emits Write tool_use + tool_result with structuredPatch', () => {
    const sink = createSink();
    const state = createState();
    const diff = '@@ -0,0 +1,2 @@\n+hello\n+world\n';
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: {
          id: 'item_2',
          type: 'fileChange',
          changes: [{ path: 'src/new.ts', kind: { type: 'add' }, diff }],
          status: 'completed',
        },
      },
      sink,
      state,
    );
    expect(sink.onMessage).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'tool_use',
        id: 'item_2:0',
        name: 'Write',
        input: expect.objectContaining({ file_path: 'src/new.ts', content: 'hello\nworld' }),
      }),
    ]);
    expect(sink.onToolResult).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'tool_result',
        toolUseId: 'item_2:0',
        isError: false,
        structuredPatch: expect.arrayContaining([expect.objectContaining({ lines: expect.any(Array) })]),
      }),
    ]);
  });

  it('item/completed fileChange (update) emits Edit tool_use + tool_result with structuredPatch', () => {
    const sink = createSink();
    const state = createState();
    const diff = '@@ -1,1 +1,1 @@\n-old\n+new\n';
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: {
          id: 'item_3',
          type: 'fileChange',
          changes: [{ path: 'src/main.ts', kind: { type: 'update', move_path: null }, diff }],
          status: 'completed',
        },
      },
      sink,
      state,
    );
    expect(sink.onMessage).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'tool_use',
        id: 'item_3:0',
        name: 'Edit',
        input: expect.objectContaining({ file_path: 'src/main.ts' }),
      }),
    ]);
    expect(sink.onToolResult).toHaveBeenCalledWith([
      expect.objectContaining({ toolUseId: 'item_3:0', isError: false, structuredPatch: expect.any(Array) }),
    ]);
  });

  it('item/completed fileChange with mixed changes (add + update) emits TWO tool_use blocks with distinct ids', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: {
          id: 'item_4',
          type: 'fileChange',
          changes: [
            { path: 'src/a.ts', kind: { type: 'add' }, diff: '+line\n' },
            { path: 'src/b.ts', kind: { type: 'update', move_path: null }, diff: '-old\n+new\n' },
          ],
          status: 'completed',
        },
      },
      sink,
      state,
    );
    expect(sink.onMessage).toHaveBeenCalledTimes(2);
    expect(sink.onMessage).toHaveBeenNthCalledWith(1, [expect.objectContaining({ id: 'item_4:0', name: 'Write' })]);
    expect(sink.onMessage).toHaveBeenNthCalledWith(2, [expect.objectContaining({ id: 'item_4:1', name: 'Edit' })]);
    expect(sink.onToolResult).toHaveBeenCalledTimes(2);
  });

  it('item/completed fileChange (update with move_path) includes move_path in input', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: {
          id: 'item_5',
          type: 'fileChange',
          changes: [{ path: 'src/old.ts', kind: { type: 'update', move_path: 'src/new.ts' }, diff: '' }],
          status: 'completed',
        },
      },
      sink,
      state,
    );
    expect(sink.onMessage).toHaveBeenCalledWith([
      expect.objectContaining({ input: expect.objectContaining({ move_path: 'src/new.ts' }) }),
    ]);
  });

  it('item/completed fileChange with status failed sets isError true on tool_result', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: {
          id: 'item_6',
          type: 'fileChange',
          changes: [{ path: 'src/main.ts', kind: { type: 'update', move_path: null }, diff: '' }],
          status: 'failed',
        },
      },
      sink,
      state,
    );
    expect(sink.onToolResult).toHaveBeenCalledWith([expect.objectContaining({ isError: true })]);
  });

  it('item/completed fileChange with status inProgress emits tool_use but no tool_result', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: {
          id: 'item_7',
          type: 'fileChange',
          changes: [{ path: 'src/main.ts', kind: { type: 'update', move_path: null }, diff: '' }],
          status: 'inProgress',
        },
      },
      sink,
      state,
    );
    expect(sink.onMessage).toHaveBeenCalled();
    expect(sink.onToolResult).not.toHaveBeenCalled();
  });

  it('item/completed mcpToolCall emits mcp__<server>__<tool> name', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: {
          id: 'item_8',
          type: 'mcpToolCall',
          server: 'my-mcp',
          tool: 'search',
          arguments: { query: 'foo' },
          result: { content: [{ found: true }], structuredContent: null, _meta: null },
          error: null,
          status: 'completed',
        },
      },
      sink,
      state,
    );
    expect(sink.onMessage).toHaveBeenCalledWith([
      {
        type: 'tool_use',
        id: 'item_8',
        name: 'mcp__my-mcp__search',
        input: { query: 'foo' },
      },
    ]);
    expect(sink.onToolResult).toHaveBeenCalledWith([
      {
        type: 'tool_result',
        toolUseId: 'item_8',
        content: JSON.stringify([{ found: true }]),
        isError: false,
      },
    ]);
  });

  it('item/completed mcpToolCall with fs server emits mcp__fs__read_file', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: {
          id: 'item_9',
          type: 'mcpToolCall',
          server: 'fs',
          tool: 'read_file',
          arguments: { path: '/tmp/x' },
          result: { content: ['data'], structuredContent: null, _meta: null },
          error: null,
          status: 'completed',
        },
      },
      sink,
      state,
    );
    expect(sink.onMessage).toHaveBeenCalledWith([expect.objectContaining({ name: 'mcp__fs__read_file' })]);
  });

  it('item/completed mcpToolCall with no server falls back to mcp__codex__<tool>', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: {
          id: 'item_10',
          type: 'mcpToolCall',
          server: undefined as unknown as string,
          tool: 'list',
          arguments: {},
          result: null,
          error: null,
          status: 'completed',
        },
      },
      sink,
      state,
    );
    expect(sink.onMessage).toHaveBeenCalledWith([expect.objectContaining({ name: 'mcp__codex__list' })]);
  });

  it('item/completed mcpToolCall with non-null error sets is_error true and content from error.message', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: {
          id: 'item_11',
          type: 'mcpToolCall',
          server: 'fs',
          tool: 'write',
          arguments: {},
          result: null,
          error: { message: 'permission denied' },
          status: 'failed',
        },
      },
      sink,
      state,
    );
    expect(sink.onToolResult).toHaveBeenCalledWith([
      expect.objectContaining({ isError: true, content: 'permission denied' }),
    ]);
  });

  it('turn/completed calls onResult with usage from prior tokenUsage event', () => {
    const sink = createSink();
    const state = createState();
    state.currentTurnId = 'turn_1';
    // Simulate token usage arriving before turn/completed
    handleNotification(
      'thread/tokenUsage/updated',
      { threadId: 't1', usage: { input_tokens: 100, output_tokens: 50 } },
      sink,
      state,
    );
    handleNotification(
      'turn/completed',
      {
        threadId: 't1',
        turn: { id: 'turn_1', status: 'completed', items: [], error: null },
      },
      sink,
      state,
    );
    expect(sink.onResult).toHaveBeenCalledWith({
      total_cost_usd: 0,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: undefined },
      subtype: undefined,
      is_error: false,
    });
    expect(state.currentTurnId).toBeNull();
  });

  it('turn/completed with failed status sets is_error', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'turn/completed',
      {
        threadId: 't1',
        turn: { id: 'turn_1', status: 'failed', items: [], error: { message: 'something went wrong' } },
      },
      sink,
      state,
    );
    expect(sink.onResult).toHaveBeenCalledWith(
      expect.objectContaining({
        subtype: 'error_during_execution',
        is_error: true,
      }),
    );
  });

  it('thread/compacted calls onCompact', () => {
    const sink = createSink();
    const state = createState();
    handleNotification('thread/compacted', {}, sink, state);
    expect(sink.onCompact).toHaveBeenCalled();
  });
});
