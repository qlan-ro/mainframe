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
    onPlanFile: vi.fn(),
    onSkillFile: vi.fn(),
  };
}

function createState(): CodexSessionState {
  return { threadId: null, currentTurnId: null };
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
        item: { id: 'item_1', type: 'reasoning', text: 'Let me think...' },
      },
      sink,
      state,
    );
    expect(sink.onMessage).toHaveBeenCalledWith([{ type: 'thinking', thinking: 'Let me think...' }]);
  });

  it('item/completed commandExecution calls onMessage then onToolResult', () => {
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
          aggregated_output: 'file.txt\n',
          exit_code: 0,
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
        name: 'command_execution',
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

  it('item/completed commandExecution with non-zero exit_code sets isError true', () => {
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
          aggregated_output: '',
          exit_code: 1,
          status: 'failed',
        },
      },
      sink,
      state,
    );
    expect(sink.onToolResult).toHaveBeenCalledWith([expect.objectContaining({ isError: true })]);
  });

  it('item/completed fileChange calls onMessage then onToolResult', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: {
          id: 'item_2',
          type: 'fileChange',
          changes: [{ path: 'src/main.ts', kind: 'update' }],
          status: 'completed',
        },
      },
      sink,
      state,
    );
    expect(sink.onMessage).toHaveBeenCalledWith([
      {
        type: 'tool_use',
        id: 'item_2',
        name: 'file_change',
        input: { changes: [{ path: 'src/main.ts', kind: 'update' }] },
      },
    ]);
    expect(sink.onToolResult).toHaveBeenCalledWith([
      {
        type: 'tool_result',
        toolUseId: 'item_2',
        content: 'applied',
        isError: false,
      },
    ]);
  });

  it('item/completed mcpToolCall calls onMessage then onToolResult', () => {
    const sink = createSink();
    const state = createState();
    handleNotification(
      'item/completed',
      {
        threadId: 't1',
        turnId: 'turn_1',
        item: {
          id: 'item_3',
          type: 'mcpToolCall',
          server: 'my-mcp',
          tool: 'search',
          arguments: { query: 'foo' },
          result: '{"found": true}',
          status: 'completed',
        },
      },
      sink,
      state,
    );
    expect(sink.onMessage).toHaveBeenCalledWith([
      {
        type: 'tool_use',
        id: 'item_3',
        name: 'search',
        input: { query: 'foo' },
      },
    ]);
    expect(sink.onToolResult).toHaveBeenCalledWith([
      {
        type: 'tool_result',
        toolUseId: 'item_3',
        content: '{"found": true}',
        isError: false,
      },
    ]);
  });

  it('turn/completed calls onResult and clears currentTurnId', () => {
    const sink = createSink();
    const state = createState();
    state.currentTurnId = 'turn_1';
    handleNotification(
      'turn/completed',
      {
        threadId: 't1',
        turn: { id: 'turn_1', status: 'completed', items: [], usage: { input_tokens: 100, output_tokens: 50 } },
      },
      sink,
      state,
    );
    expect(sink.onResult).toHaveBeenCalledWith({
      total_cost_usd: 0,
      usage: { input_tokens: 100, output_tokens: 50 },
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
        turn: { id: 'turn_1', status: 'failed', items: [] },
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
