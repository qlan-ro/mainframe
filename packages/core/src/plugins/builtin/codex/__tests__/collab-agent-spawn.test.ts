// packages/core/src/plugins/builtin/codex/__tests__/collab-agent-spawn.test.ts
//
// Codex 0.125 emits each sub-agent delegation as TWO `collabAgentToolCall` items:
//   - tool: "spawnAgent" — dispatch metadata (carries the prompt). Renders nothing on its own.
//   - tool: "wait"       — the renderable card; carries the sub-agent's output in
//                          `agentsStates[childThreadId].message`.
// The card description is the prompt from the spawnAgent item (looked up by child thread id).

import { describe, it, expect, vi } from 'vitest';
import { handleNotification } from '../event-mapper.js';
import type { SessionSink } from '@qlan-ro/mainframe-types';
import type { CodexSessionState } from '../event-mapper.js';

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
    onSubagentChild: vi.fn(),
  };
}

function createState(): CodexSessionState {
  return { threadId: 'parent_thread', currentTurnId: 'turn_1', currentTurnPlan: null };
}

const SPAWN_AGENT = {
  id: 'spawn_item_1',
  type: 'collabAgentToolCall' as const,
  tool: 'spawnAgent' as const,
  status: 'completed' as const,
  senderThreadId: 'parent_thread',
  receiverThreadIds: ['child_thread_1'],
  prompt: 'Investigate the codebase',
};

const WAIT_INPROGRESS = {
  id: 'wait_item_1',
  type: 'collabAgentToolCall' as const,
  tool: 'wait' as const,
  status: 'inProgress' as const,
  senderThreadId: 'parent_thread',
  receiverThreadIds: ['child_thread_1'],
  prompt: null,
};

const WAIT_COMPLETED = {
  ...WAIT_INPROGRESS,
  status: 'completed' as const,
  agentsStates: { child_thread_1: { status: 'completed', message: 'Found 3 files' } },
};

function dispatchSpawn(sink: SessionSink, state: CodexSessionState): void {
  handleNotification(
    'item/started',
    { threadId: 'parent_thread', turnId: 'turn_1', item: { ...SPAWN_AGENT, status: 'inProgress' } },
    sink,
    state,
  );
  handleNotification('item/completed', { threadId: 'parent_thread', turnId: 'turn_1', item: SPAWN_AGENT }, sink, state);
}

describe('Codex collabAgentToolCall — CollabAgent card', () => {
  it('spawnAgent items emit no card and only stash the prompt', () => {
    const sink = createSink();
    const state = createState();

    dispatchSpawn(sink, state);

    expect(sink.onMessage).not.toHaveBeenCalled();
    expect(sink.onToolResult).not.toHaveBeenCalled();
    expect(state.spawnPrompts?.get('child_thread_1')).toBe('Investigate the codebase');
  });

  it('wait/started opens a CollabAgent card using the stashed spawn prompt as description', () => {
    const sink = createSink();
    const state = createState();

    dispatchSpawn(sink, state);
    handleNotification(
      'item/started',
      { threadId: 'parent_thread', turnId: 'turn_1', item: WAIT_INPROGRESS },
      sink,
      state,
    );

    expect(sink.onMessage).toHaveBeenCalledTimes(1);
    const [blocks] = (sink.onMessage as ReturnType<typeof vi.fn>).mock.calls[0]!;
    // No agent metadata available in the test → title falls back to "Sub-agent" and
    // description falls back to the spawn prompt (since role is unavailable).
    expect(blocks).toEqual([
      {
        type: 'tool_use',
        id: 'wait_item_1',
        name: 'CollabAgent',
        input: {
          prompt: 'Investigate the codebase',
          description: 'Investigate the codebase',
          subagent_type: 'Sub-agent',
        },
      },
    ]);
  });

  it('wait/completed emits tool_result with the sub-agent message and clears state', () => {
    const sink = createSink();
    const state = createState();

    dispatchSpawn(sink, state);
    handleNotification(
      'item/started',
      { threadId: 'parent_thread', turnId: 'turn_1', item: WAIT_INPROGRESS },
      sink,
      state,
    );
    (sink.onMessage as ReturnType<typeof vi.fn>).mockClear();

    handleNotification(
      'item/completed',
      { threadId: 'parent_thread', turnId: 'turn_1', item: WAIT_COMPLETED },
      sink,
      state,
    );

    expect(sink.onMessage).not.toHaveBeenCalled();
    expect(sink.onToolResult).toHaveBeenCalledTimes(1);
    const [results] = (sink.onToolResult as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(results).toEqual([
      { type: 'tool_result', toolUseId: 'wait_item_1', content: 'Found 3 files', isError: false },
    ]);
    expect(state.openCollabCards?.has('wait_item_1')).toBe(false);
    expect(state.collabChildThreads?.has('child_thread_1')).toBe(false);
    expect(state.spawnPrompts?.has('child_thread_1')).toBe(false);
  });

  it('wait/completed without prior wait/started still emits both tool_use and tool_result', () => {
    const sink = createSink();
    const state = createState();

    dispatchSpawn(sink, state);
    handleNotification(
      'item/completed',
      { threadId: 'parent_thread', turnId: 'turn_1', item: WAIT_COMPLETED },
      sink,
      state,
    );

    expect(sink.onMessage).toHaveBeenCalledTimes(1);
    expect(sink.onToolResult).toHaveBeenCalledTimes(1);
  });

  it('failed and interrupted wait statuses produce isError: true', () => {
    for (const status of ['failed', 'interrupted'] as const) {
      const sink = createSink();
      const state = createState();
      dispatchSpawn(sink, state);
      handleNotification(
        'item/completed',
        { threadId: 'parent_thread', turnId: 'turn_1', item: { ...WAIT_COMPLETED, status } },
        sink,
        state,
      );
      const [results] = (sink.onToolResult as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(results[0].isError).toBe(true);
    }
  });

  it('child-thread items emitted between wait/started and wait/completed are tagged with parentToolUseId', () => {
    const sink = createSink();
    const state = createState();

    dispatchSpawn(sink, state);
    handleNotification(
      'item/started',
      { threadId: 'parent_thread', turnId: 'turn_1', item: WAIT_INPROGRESS },
      sink,
      state,
    );
    (sink.onMessage as ReturnType<typeof vi.fn>).mockClear();

    handleNotification(
      'item/completed',
      {
        threadId: 'child_thread_1',
        turnId: 'child_turn_1',
        item: {
          id: 'cmd_1',
          type: 'commandExecution',
          command: 'ls',
          aggregatedOutput: 'a\nb',
          exitCode: 0,
          status: 'completed',
        },
      },
      sink,
      state,
    );

    const [msgBlocks] = (sink.onMessage as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const [resBlocks] = (sink.onToolResult as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(msgBlocks[0]).toMatchObject({ type: 'tool_use', name: 'Bash', parentToolUseId: 'wait_item_1' });
    expect(resBlocks[0]).toMatchObject({ type: 'tool_result', parentToolUseId: 'wait_item_1' });
  });

  it('item/started for non-collab items is ignored', () => {
    const sink = createSink();
    const state = createState();

    handleNotification(
      'item/started',
      {
        threadId: 'parent_thread',
        turnId: 'turn_1',
        item: { id: 'cmd_1', type: 'commandExecution', command: 'ls', aggregatedOutput: '', status: 'in_progress' },
      },
      sink,
      state,
    );

    expect(sink.onMessage).not.toHaveBeenCalled();
  });
});
