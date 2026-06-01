import { describe, it, expect } from 'vitest';
import {
  groupToolCallParts,
  groupTaskChildren,
  type PartEntry,
  type ToolGroupItem,
  type TaskProgressItem,
} from '../../messages/tool-grouping.js';
import type { ToolCategories } from '../../messages/tool-categorization.js';

/* ── fixtures ────────────────────────────────────────────────────── */

// Mirrors ClaudeAdapter.getToolCategories(): the V2 task tools are BOTH hidden
// (never rendered as raw tool cards) AND progress (surfaced as _TaskProgress).
// Progress therefore takes precedence over hidden in grouping.
const CLAUDE_CATEGORIES: ToolCategories = {
  explore: new Set(['Read', 'Glob', 'Grep']),
  hidden: new Set([
    'TodoWrite',
    'TaskCreate',
    'TaskUpdate',
    'TaskList',
    'TaskGet',
    'TaskOutput',
    'TaskStop',
    'Skill',
    'EnterPlanMode',
    'AskUserQuestion',
  ]),
  progress: new Set(['TaskCreate', 'TaskUpdate']),
  subagent: new Set(['Task']),
};

const EMPTY_CATEGORIES: ToolCategories = {
  explore: new Set(),
  hidden: new Set(),
  progress: new Set(),
  subagent: new Set(),
};

/* ── helpers ─────────────────────────────────────────────────────── */

function tc(toolName: string, id?: string, result?: unknown, isError?: boolean): PartEntry {
  return {
    type: 'tool-call',
    toolCallId: id ?? `call-${toolName}`,
    toolName,
    args: { some: 'arg' },
    result,
    isError,
  };
}

function tcTagged(toolName: string, id: string, parentToolUseId: string, result?: unknown): PartEntry {
  return {
    type: 'tool-call',
    toolCallId: id,
    toolName,
    args: { some: 'arg' },
    result,
    parentToolUseId,
  };
}

function text(t: string): PartEntry {
  return { type: 'text', text: t };
}

/* ── groupToolCallParts ──────────────────────────────────────────── */

describe('groupToolCallParts', () => {
  it('returns empty array for empty input', () => {
    expect(groupToolCallParts([], CLAUDE_CATEGORIES)).toEqual([]);
  });

  it('passes through a single non-tool text entry', () => {
    const parts = [text('hello')];
    expect(groupToolCallParts(parts, CLAUDE_CATEGORIES)).toEqual([text('hello')]);
  });

  it('passes through a single non-explore, non-hidden, non-task tool call', () => {
    const part = tc('Bash', 'b1', 'done');
    const result = groupToolCallParts([part], CLAUDE_CATEGORIES);
    expect(result).toEqual([part]);
  });

  it('passes through a single explore tool without grouping', () => {
    const part = tc('Read', 'r1', 'file content');
    const result = groupToolCallParts([part], CLAUDE_CATEGORIES);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(part);
  });

  it('groups 2+ consecutive explore tools into a _ToolGroup', () => {
    const parts = [tc('Read', 'r1'), tc('Grep', 'g1'), tc('Glob', 'gl1')];
    const result = groupToolCallParts(parts, CLAUDE_CATEGORIES);

    expect(result).toHaveLength(1);
    const group = result[0]!;
    expect(group.type).toBe('_tool_group');
    if (group.type !== '_tool_group') throw new Error('not _tool_group');
    expect(group.toolCallId).toBe('r1');
    expect(group.result).toBe('grouped');

    const items = group.items as ToolGroupItem[];
    expect(items).toHaveLength(3);
    expect(items[0]!.toolName).toBe('Read');
    expect(items[1]!.toolName).toBe('Grep');
    expect(items[2]!.toolName).toBe('Glob');
  });

  it('does not group a single explore tool (needs >= 2)', () => {
    const parts = [tc('Read', 'r1')];
    const result = groupToolCallParts(parts, CLAUDE_CATEGORIES);
    expect(result).toHaveLength(1);
    expect((result[0] as PartEntry & { type: 'tool-call' }).toolName).toBe('Read');
  });

  it('removes hidden tools from output', () => {
    const parts = [tc('TodoWrite', 'h1'), tc('Bash', 'b1')];
    const result = groupToolCallParts(parts, CLAUDE_CATEGORIES);
    expect(result).toHaveLength(1);
    expect((result[0] as PartEntry & { type: 'tool-call' }).toolName).toBe('Bash');
  });

  it('removes all hidden tool types', () => {
    const hiddenNames = [
      'TaskList',
      'TaskGet',
      'TaskOutput',
      'TaskStop',
      'TodoWrite',
      'Skill',
      'EnterPlanMode',
      'AskUserQuestion',
    ];
    const parts = hiddenNames.map((name) => tc(name));
    const result = groupToolCallParts(parts, CLAUDE_CATEGORIES);
    expect(result).toEqual([]);
  });

  it('accumulates task progress tools into a single _TaskProgress entry', () => {
    const parts = [tc('TaskCreate', 'tc1'), tc('TaskUpdate', 'tu1')];
    const result = groupToolCallParts(parts, CLAUDE_CATEGORIES);

    expect(result).toHaveLength(1);
    const entry = result[0]!;
    if (entry.type !== '_task_progress') throw new Error('expected _task_progress');
    expect(entry.toolCallId).toBe('tc1');
    expect(entry.result).toBe('accumulated');

    const items = entry.items as TaskProgressItem[];
    expect(items).toHaveLength(2);
    expect(items[0]!.toolName).toBe('TaskCreate');
    expect(items[1]!.toolName).toBe('TaskUpdate');
  });

  it('places _TaskProgress at the position of the first task tool', () => {
    const parts = [tc('Bash', 'b1'), tc('TaskCreate', 'tc1'), tc('Edit', 'e1'), tc('TaskUpdate', 'tu1')];
    const result = groupToolCallParts(parts, CLAUDE_CATEGORIES);

    // Bash at index 0, _TaskProgress at index 1, Edit at index 2
    expect(result).toHaveLength(3);
    expect((result[0] as PartEntry & { type: 'tool-call' }).toolName).toBe('Bash');
    expect(result[1]!.type).toBe('_task_progress');
    expect((result[2] as PartEntry & { type: 'tool-call' }).toolName).toBe('Edit');
  });

  it('skips hidden tools interspersed between explore tools when grouping', () => {
    // Read, TodoWrite (hidden), Grep should still group Read+Grep
    const parts = [tc('Read', 'r1'), tc('TodoWrite', 'h1'), tc('Grep', 'g1')];
    const result = groupToolCallParts(parts, CLAUDE_CATEGORIES);

    expect(result).toHaveLength(1);
    const group = result[0]!;
    if (group.type !== '_tool_group') throw new Error('expected _tool_group');
    const items = group.items as ToolGroupItem[];
    expect(items).toHaveLength(2);
    expect(items[0]!.toolName).toBe('Read');
    expect(items[1]!.toolName).toBe('Grep');
  });

  it('skips task progress tools interspersed between explore tools when grouping', () => {
    // When a TaskCreate sits between two explore tools, the inner explore-grouping
    // loop sees it as a non-breaking tool and skips over it. However, since the
    // inner loop does not add it to the outer taskItems collector, the task tool
    // is effectively consumed (lost). The explore tools still group together.
    const parts = [tc('Read', 'r1'), tc('TaskCreate', 'tc1'), tc('Glob', 'gl1')];
    const result = groupToolCallParts(parts, CLAUDE_CATEGORIES);

    // Read+Glob are grouped; TaskCreate is accumulated by the explore look-ahead
    // into a _task_progress entry (not dropped).
    const toolGroup = result.find((p) => p.type === '_tool_group');
    expect(toolGroup).toBeDefined();
    if (toolGroup?.type !== '_tool_group') throw new Error('expected _tool_group');
    const items = toolGroup.items as ToolGroupItem[];
    expect(items).toHaveLength(2);
    expect(items[0]!.toolName).toBe('Read');
    expect(items[1]!.toolName).toBe('Glob');
  });

  it('breaks explore group on a non-explore, non-hidden, non-task tool', () => {
    const parts = [tc('Read', 'r1'), tc('Bash', 'b1'), tc('Grep', 'g1')];
    const result = groupToolCallParts(parts, CLAUDE_CATEGORIES);

    // Read alone (no group), Bash, Grep alone (no group)
    expect(result).toHaveLength(3);
    expect((result[0] as PartEntry & { type: 'tool-call' }).toolName).toBe('Read');
    expect((result[1] as PartEntry & { type: 'tool-call' }).toolName).toBe('Bash');
    expect((result[2] as PartEntry & { type: 'tool-call' }).toolName).toBe('Grep');
  });

  it('breaks explore group on a text entry', () => {
    const parts = [tc('Read', 'r1'), text('thinking...'), tc('Grep', 'g1')];
    const result = groupToolCallParts(parts, CLAUDE_CATEGORIES);

    expect(result).toHaveLength(3);
    expect((result[0] as PartEntry & { type: 'tool-call' }).toolName).toBe('Read');
    expect(result[1]).toEqual(text('thinking...'));
    expect((result[2] as PartEntry & { type: 'tool-call' }).toolName).toBe('Grep');
  });

  it('handles mixed text, explore, hidden, task, and normal tools', () => {
    const parts = [
      text('starting'),
      tc('Read', 'r1'),
      tc('Grep', 'g1'),
      tc('TodoWrite', 'h1'),
      tc('TaskCreate', 'tc1'),
      tc('Bash', 'b1'),
      text('done'),
    ];
    const result = groupToolCallParts(parts, CLAUDE_CATEGORIES);

    const names = result.map((p) => {
      if (p.type === 'text') return `text:${p.text}`;
      if (p.type === '_tool_group') return 'tool:_ToolGroup';
      if (p.type === '_task_progress') return 'tool:_TaskProgress';
      if (p.type === 'tool-call') return `tool:${p.toolName}`;
      return `tool:unknown`;
    });
    // The inner explore-grouping loop scans past TodoWrite (hidden) and TaskCreate
    // (task progress) without breaking the explore run. TodoWrite is suppressed,
    // but TaskCreate is accumulated into the taskItems collector, so a single
    // _TaskProgress entry appears at the position where the task tool was seen.
    expect(names).toEqual(['text:starting', 'tool:_TaskProgress', 'tool:_ToolGroup', 'tool:Bash', 'text:done']);
  });

  it('produces _TaskProgress when task tools are NOT inside an explore run', () => {
    const parts = [tc('TaskCreate', 'tc1'), tc('Bash', 'b1'), tc('TaskUpdate', 'tu1')];
    const result = groupToolCallParts(parts, CLAUDE_CATEGORIES);

    const names = result.map((p) => {
      if (p.type === 'text') return `text:${p.text}`;
      if (p.type === '_tool_group') return 'tool:_ToolGroup';
      if (p.type === '_task_progress') return 'tool:_TaskProgress';
      if (p.type === 'tool-call') return `tool:${p.toolName}`;
      return `tool:unknown`;
    });
    // _TaskProgress is inserted at position 0 (first task tool position), Bash at position 1
    expect(names).toEqual(['tool:_TaskProgress', 'tool:Bash']);
  });

  it('preserves tool call args and result through grouping', () => {
    const parts = [
      { type: 'tool-call' as const, toolCallId: 'r1', toolName: 'Read', args: { file: '/a.ts' }, result: 'content A' },
      { type: 'tool-call' as const, toolCallId: 'g1', toolName: 'Grep', args: { pattern: 'foo' }, result: 'match' },
    ];
    const result = groupToolCallParts(parts, CLAUDE_CATEGORIES);
    const group = result[0]!;
    if (group.type !== '_tool_group') throw new Error('expected _tool_group');
    const items = group.items as ToolGroupItem[];
    expect(items[0]!.args).toEqual({ file: '/a.ts' });
    expect(items[0]!.result).toBe('content A');
    expect(items[1]!.args).toEqual({ pattern: 'foo' });
    expect(items[1]!.result).toBe('match');
  });

  it('preserves isError on grouped explore tools', () => {
    const parts = [
      { type: 'tool-call' as const, toolCallId: 'r1', toolName: 'Read', args: {}, result: 'err', isError: true },
      { type: 'tool-call' as const, toolCallId: 'g1', toolName: 'Glob', args: {}, result: 'ok', isError: false },
    ];
    const result = groupToolCallParts(parts, CLAUDE_CATEGORIES);
    const group = result[0]!;
    if (group.type !== '_tool_group') throw new Error('expected _tool_group');
    const items = group.items as ToolGroupItem[];
    expect(items[0]!.isError).toBe(true);
    expect(items[1]!.isError).toBe(false);
  });
});

describe('with empty categories (no grouping)', () => {
  it('passes all tool calls through ungrouped', () => {
    const parts = [tc('Read', 'r1'), tc('Grep', 'g1'), tc('TodoWrite', 'h1')];
    const result = groupToolCallParts(parts, EMPTY_CATEGORIES);
    expect(result).toHaveLength(3);
  });

  it('does not create _TaskGroup entries', () => {
    const parts = [tc('Task', 't1'), tc('Bash', 'b1')];
    const result = groupTaskChildren(parts, EMPTY_CATEGORIES);
    expect(result).toHaveLength(2);
    expect((result[0] as PartEntry & { type: 'tool-call' }).toolName).toBe('Task');
  });
});

/* ── groupTaskChildren ───────────────────────────────────────────── */

describe('groupTaskChildren', () => {
  it('returns empty array for empty input', () => {
    expect(groupTaskChildren([], CLAUDE_CATEGORIES)).toEqual([]);
  });

  it('passes through parts with no Task tool call', () => {
    const parts = [text('hello'), tc('Bash', 'b1'), text('done')];
    const result = groupTaskChildren(parts, CLAUDE_CATEGORIES);
    expect(result).toEqual(parts);
  });

  it('wraps a Task + tagged subsequent tool calls into a _TaskGroup', () => {
    const parts = [
      tc('Task', 't1', undefined),
      tcTagged('Bash', 'b1', 't1', 'output'),
      tcTagged('Read', 'r1', 't1', 'file'),
    ];
    const result = groupTaskChildren(parts, CLAUDE_CATEGORIES);

    expect(result).toHaveLength(1);
    const group = result[0]!;
    if (group.type !== '_task_group') throw new Error('expected _task_group');
    expect(group.toolCallId).toBe('t1');

    const children = group.children as PartEntry[];
    expect(children).toHaveLength(2);
    expect(children[0]!).toEqual(tcTagged('Bash', 'b1', 't1', 'output'));
    expect(children[1]!).toEqual(tcTagged('Read', 'r1', 't1', 'file'));
  });

  it('preserves Task args in taskArgs', () => {
    const parts = [
      { type: 'tool-call' as const, toolCallId: 't1', toolName: 'Task', args: { description: 'do stuff' } },
      tcTagged('Bash', 'b1', 't1'),
    ];
    const result = groupTaskChildren(parts, CLAUDE_CATEGORIES);
    const group = result[0]!;
    if (group.type !== '_task_group') throw new Error('expected _task_group');
    expect(group.taskArgs).toEqual({ description: 'do stuff' });
  });

  it('stops grouping at an untagged entry', () => {
    // Bash is tagged for t1; the untagged Edit terminates the run.
    const parts = [tc('Task', 't1'), tcTagged('Bash', 'b1', 't1'), text('middle'), tc('Edit', 'e1')];
    const result = groupTaskChildren(parts, CLAUDE_CATEGORIES);

    // _TaskGroup(Task+Bash), text, Edit
    expect(result).toHaveLength(3);
    const group = result[0]!;
    if (group.type !== '_task_group') throw new Error('expected _task_group');
    expect(result[1]).toEqual(text('middle'));
    expect((result[2] as PartEntry & { type: 'tool-call' }).toolName).toBe('Edit');

    const children = group.children as PartEntry[];
    expect(children).toHaveLength(1);
    expect(children[0]!).toEqual(tcTagged('Bash', 'b1', 't1'));
  });

  it('stops grouping at a child tagged for a different parent', () => {
    const parts = [tc('Task', 't1'), tcTagged('Bash', 'b1', 't1'), tc('Task', 't2'), tcTagged('Read', 'r1', 't2')];
    const result = groupTaskChildren(parts, CLAUDE_CATEGORIES);

    expect(result).toHaveLength(2);
    const group1 = result[0]!;
    const group2 = result[1]!;
    if (group1.type !== '_task_group') throw new Error('expected _task_group');
    if (group2.type !== '_task_group') throw new Error('expected _task_group');
    expect(group1.toolCallId).toBe('t1');
    expect(group2.toolCallId).toBe('t2');

    const children1 = group1.children as PartEntry[];
    expect(children1).toHaveLength(1);
    expect(children1[0]!).toEqual(tcTagged('Bash', 'b1', 't1'));

    const children2 = group2.children as PartEntry[];
    expect(children2).toHaveLength(1);
    expect(children2[0]!).toEqual(tcTagged('Read', 'r1', 't2'));
  });

  it('leaves a Task with no children as a plain Task entry', () => {
    const parts = [tc('Task', 't1'), text('after')];
    const result = groupTaskChildren(parts, CLAUDE_CATEGORIES);

    expect(result).toHaveLength(2);
    expect((result[0] as PartEntry & { type: 'tool-call' }).toolName).toBe('Task');
    expect(result[1]).toEqual(text('after'));
  });

  it('leaves a trailing Task with no children as a plain Task entry', () => {
    const parts = [text('before'), tc('Task', 't1')];
    const result = groupTaskChildren(parts, CLAUDE_CATEGORIES);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(text('before'));
    expect((result[1] as PartEntry & { type: 'tool-call' }).toolName).toBe('Task');
  });

  it('preserves result and isError on _TaskGroup', () => {
    const parts = [
      { type: 'tool-call' as const, toolCallId: 't1', toolName: 'Task', args: {}, result: 'task done', isError: false },
      tcTagged('Bash', 'b1', 't1'),
    ];
    const result = groupTaskChildren(parts, CLAUDE_CATEGORIES);
    const group = result[0]!;
    if (group.type !== '_task_group') throw new Error('expected _task_group');
    expect(group.result).toBe('task done');
    expect(group.isError).toBe(false);
  });

  // Reproduces the screenshot bug: a subagent that runs an explore burst
  // (Read/Glob/Grep) gets its tool calls collapsed into a `_ToolGroup` by
  // groupToolCallParts. groupTaskChildren then needs that wrapper to carry
  // the subagent's parentToolUseId, otherwise the wrapper falls outside the
  // _TaskGroup and renders at chat root.
  it('nests a tagged _ToolGroup inside the parent _TaskGroup', () => {
    const taskId = 't-agent';
    const exploreItems = [
      tcTagged('Read', 'r1', taskId),
      tcTagged('Grep', 'g1', taskId),
      tcTagged('Glob', 'gl1', taskId),
    ];
    const grouped = groupToolCallParts(exploreItems, CLAUDE_CATEGORIES);
    expect(grouped).toHaveLength(1);
    const groupedEntry = grouped[0]!;
    if (groupedEntry.type !== '_tool_group') throw new Error('expected _tool_group');

    const parts = [tc('Task', taskId), ...grouped];
    const result = groupTaskChildren(parts, CLAUDE_CATEGORIES);

    expect(result).toHaveLength(1);
    const group = result[0]!;
    if (group.type !== '_task_group') throw new Error('expected _task_group');

    const children = group.children as PartEntry[];
    expect(children).toHaveLength(1);
    const child = children[0]!;
    if (child.type !== '_tool_group') throw new Error('expected _tool_group');
  });
});
