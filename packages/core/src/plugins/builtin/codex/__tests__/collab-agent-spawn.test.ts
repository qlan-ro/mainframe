// packages/core/src/plugins/builtin/codex/__tests__/collab-agent-spawn.test.ts
//
// Tests for #145 — Group Codex sub-agent commands under TaskGroupCard.
// Protocol confirmed via binary reverse-engineering of Codex 0.125.0:
//   - collab_agent_spawn_begin (5 fields): threadId, turnId, itemId, prompt, receiverThreadIds
//   - collab_agent_spawn_end (9 fields): threadId, turnId, itemId, newThreadId,
//       newAgentNickname, newAgentRole, prompt, handoffId, activeTranscript
//   - ThreadItem::CollabAgentToolCall (9 fields): senderThreadId, receiverThreadIds,
//       reasoningEffort, agentsStates, prompt, contentItems, memoryCitation,
//       processId, commandActions
//
// The TaskGroup approach: on collab_agent_spawn_begin we emit a tool_use with
// name '_TaskGroup' and a generated id. Any item/completed events that follow for
// the child thread are emitted with parentToolUseId pointing to that tool_use.
// On collab_agent_spawn_end we emit the tool_result to close the group.
//
// NOTE: The Codex app-server streams ALL notifications on the parent thread,
// so we match child items by threadId present in receiverThreadIds from spawn_begin.

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

const SPAWN_BEGIN_PARAMS = {
  threadId: 'parent_thread',
  turnId: 'turn_1',
  itemId: 'item_spawn_1',
  prompt: 'Investigate the codebase',
  receiverThreadIds: ['child_thread_1'],
};

const SPAWN_END_PARAMS = {
  threadId: 'parent_thread',
  turnId: 'turn_1',
  itemId: 'item_spawn_1',
  newThreadId: 'child_thread_1',
  newAgentNickname: 'explorer',
  newAgentRole: 'subagent',
  prompt: 'Investigate the codebase',
  handoffId: 'handoff_abc',
  activeTranscript: null,
};

describe('Codex collab_agent_spawn — TaskGroup grouping', () => {
  it('collab_agent_spawn_begin emits a _TaskGroup tool_use with the spawn prompt', () => {
    const sink = createSink();
    const state = createState();

    handleNotification('collab_agent_spawn_begin', SPAWN_BEGIN_PARAMS, sink, state);

    expect(sink.onMessage).toHaveBeenCalledTimes(1);
    const [blocks] = (sink.onMessage as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'tool_use',
      name: '_TaskGroup',
      input: expect.objectContaining({ prompt: 'Investigate the codebase' }),
    });
    expect(typeof blocks[0].id).toBe('string');
    expect(blocks[0].id.length).toBeGreaterThan(0);
  });

  it('collab_agent_spawn_begin stores spawn state so child items can be routed', () => {
    const sink = createSink();
    const state = createState();

    handleNotification('collab_agent_spawn_begin', SPAWN_BEGIN_PARAMS, sink, state);

    // State should record the childThreadId → parentToolUseId mapping
    expect(state.activeSpawns).toBeDefined();
    expect(state.activeSpawns!.size).toBe(1);
    const spawnState = state.activeSpawns!.get('child_thread_1');
    expect(spawnState).toBeDefined();
    expect(spawnState!.parentToolUseId).toBeTruthy();
  });

  it('collab_agent_spawn_end emits a tool_result closing the _TaskGroup', () => {
    const sink = createSink();
    const state = createState();

    handleNotification('collab_agent_spawn_begin', SPAWN_BEGIN_PARAMS, sink, state);
    (sink.onMessage as ReturnType<typeof vi.fn>).mockClear();

    handleNotification('collab_agent_spawn_end', SPAWN_END_PARAMS, sink, state);

    expect(sink.onToolResult).toHaveBeenCalledTimes(1);
    const [results] = (sink.onToolResult as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'tool_result',
      isError: false,
    });
  });

  it('collab_agent_spawn_end clears the spawn state for the child thread', () => {
    const sink = createSink();
    const state = createState();

    handleNotification('collab_agent_spawn_begin', SPAWN_BEGIN_PARAMS, sink, state);
    handleNotification('collab_agent_spawn_end', SPAWN_END_PARAMS, sink, state);

    expect(state.activeSpawns!.has('child_thread_1')).toBe(false);
  });

  it('item/completed on child thread is emitted with parentToolUseId', () => {
    const sink = createSink();
    const state = createState();

    handleNotification('collab_agent_spawn_begin', SPAWN_BEGIN_PARAMS, sink, state);
    const spawnState = state.activeSpawns!.get('child_thread_1')!;
    const expectedParentId = spawnState.parentToolUseId;
    (sink.onMessage as ReturnType<typeof vi.fn>).mockClear();

    // A child thread item arriving on the parent's notification stream
    handleNotification(
      'item/completed',
      {
        threadId: 'child_thread_1',
        turnId: 'child_turn_1',
        item: { id: 'child_item_1', type: 'agentMessage', text: 'Found 3 files' },
      },
      sink,
      state,
    );

    expect(sink.onMessage).toHaveBeenCalledTimes(1);
    const [blocks] = (sink.onMessage as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(blocks[0]).toMatchObject({
      type: 'text',
      text: 'Found 3 files',
      parentToolUseId: expectedParentId,
    });
  });

  it('item/completed on parent thread is NOT tagged with parentToolUseId', () => {
    const sink = createSink();
    const state = createState();

    handleNotification('collab_agent_spawn_begin', SPAWN_BEGIN_PARAMS, sink, state);
    (sink.onMessage as ReturnType<typeof vi.fn>).mockClear();

    // A parent-thread item should route normally, no parentToolUseId
    handleNotification(
      'item/completed',
      {
        threadId: 'parent_thread',
        turnId: 'turn_1',
        item: { id: 'parent_item_1', type: 'agentMessage', text: 'Done' },
      },
      sink,
      state,
    );

    const [blocks] = (sink.onMessage as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(blocks[0]).not.toHaveProperty('parentToolUseId');
  });

  it('collab_agent_spawn_end without prior spawn_begin is handled gracefully (no crash)', () => {
    const sink = createSink();
    const state = createState();

    expect(() => handleNotification('collab_agent_spawn_end', SPAWN_END_PARAMS, sink, state)).not.toThrow();
    expect(sink.onToolResult).not.toHaveBeenCalled();
  });
});
