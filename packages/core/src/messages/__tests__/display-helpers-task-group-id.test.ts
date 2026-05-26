import { describe, it, expect } from 'vitest';
import { applyToolGrouping } from '../display-helpers.js';
import type { DisplayContent, ToolCategories } from '@qlan-ro/mainframe-types';

/**
 * Regression for #184 — Codex app crash "Duplicate key toolCallId-default in tapResources".
 *
 * The desktop renderer keys each tool part by its toolCallId. `convertGroupedPartsToDisplay`
 * builds the `task_group` block's `agentId` field, which `convert-message.ts` then uses as
 * the React key. If the agentId was derived from `taskArgs.description` (a non-unique label),
 * two subagent spawns in one turn with the same description collided.
 *
 * The fix: always derive `agentId` from the unique tool_use id (`part.toolCallId`).
 */
describe('applyToolGrouping — task_group agentId uniqueness (regression #184)', () => {
  const categories: ToolCategories = {
    explore: new Set<string>(),
    hidden: new Set<string>(),
    progress: new Set<string>(),
    subagent: new Set<string>(['CollabAgent']),
  };

  it('uses the unique tool_use id as agentId even when descriptions repeat', () => {
    const description = 'default';
    const content: DisplayContent[] = [
      {
        type: 'tool_call',
        id: 'call-A',
        name: 'CollabAgent',
        input: { prompt: 'p1', description, subagent_type: 'role' },
        category: 'subagent',
      },
      // A child belonging to subagent A — tagged with parentToolUseId so it nests under A.
      {
        type: 'tool_call',
        id: 'child-A',
        name: 'Bash',
        input: { command: 'echo a' },
        category: 'default',
        parentToolUseId: 'call-A',
      },
      {
        type: 'tool_call',
        id: 'call-B',
        name: 'CollabAgent',
        input: { prompt: 'p2', description, subagent_type: 'role' },
        category: 'subagent',
      },
      {
        type: 'tool_call',
        id: 'child-B',
        name: 'Bash',
        input: { command: 'echo b' },
        category: 'default',
        parentToolUseId: 'call-B',
      },
    ];

    const out = applyToolGrouping(content, categories);
    const taskGroups = out.filter((c): c is DisplayContent & { type: 'task_group' } => c.type === 'task_group');

    expect(taskGroups).toHaveLength(2);
    expect(taskGroups[0]!.agentId).toBe('call-A');
    expect(taskGroups[1]!.agentId).toBe('call-B');
    // The unique tool_use ids must survive — no collapsing onto `description`.
    expect(taskGroups[0]!.agentId).not.toBe(taskGroups[1]!.agentId);

    // Grouping invariant: each child nests under the correct parent. Switching
    // agentId from description to toolCallId must NOT change which children
    // belong to which subagent (groupTaskChildren matches on parentToolUseId,
    // not on agentId).
    const aCallIds = taskGroups[0]!.calls
      .filter((c): c is DisplayContent & { type: 'tool_call' } => c.type === 'tool_call')
      .map((c) => c.id);
    const bCallIds = taskGroups[1]!.calls
      .filter((c): c is DisplayContent & { type: 'tool_call' } => c.type === 'tool_call')
      .map((c) => c.id);
    expect(aCallIds).toEqual(['child-A']);
    expect(bCallIds).toEqual(['child-B']);
  });

  it('preserves grouping for a single subagent (no regression on the common case)', () => {
    // Sanity check that the description→toolCallId change doesn't break the
    // single-subagent path that Claude sessions hit most often.
    const content: DisplayContent[] = [
      {
        type: 'tool_call',
        id: 'toolu_001',
        name: 'CollabAgent',
        input: { description: 'investigate auth bug', prompt: '...' },
        category: 'subagent',
      },
      {
        type: 'tool_call',
        id: 'toolu_002',
        name: 'Read',
        input: { file_path: '/auth.ts' },
        category: 'default',
        parentToolUseId: 'toolu_001',
      },
      {
        type: 'tool_call',
        id: 'toolu_003',
        name: 'Grep',
        input: { pattern: 'login' },
        category: 'default',
        parentToolUseId: 'toolu_001',
      },
    ];

    const out = applyToolGrouping(content, categories);
    const taskGroups = out.filter((c): c is DisplayContent & { type: 'task_group' } => c.type === 'task_group');
    expect(taskGroups).toHaveLength(1);
    expect(taskGroups[0]!.agentId).toBe('toolu_001');
    // taskArgs.description still carries the human label for the card title.
    expect(taskGroups[0]!.taskArgs.description).toBe('investigate auth bug');
    expect(taskGroups[0]!.calls).toHaveLength(2);
  });
});
