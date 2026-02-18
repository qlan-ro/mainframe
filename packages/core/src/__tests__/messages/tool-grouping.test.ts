import { describe, it, expect } from 'vitest';
import {
  groupToolCallParts,
  groupTaskChildren,
  type PartEntry,
  type ToolGroupItem,
  type TaskProgressItem,
} from '../../messages/tool-grouping.js';

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

function text(t: string): PartEntry {
  return { type: 'text', text: t };
}

/* ── groupToolCallParts ──────────────────────────────────────────── */

describe('groupToolCallParts', () => {
  it('returns empty array for empty input', () => {
    expect(groupToolCallParts([])).toEqual([]);
  });

  it('passes through a single non-tool text entry', () => {
    const parts = [text('hello')];
    expect(groupToolCallParts(parts)).toEqual([text('hello')]);
  });

  it('passes through a single non-explore, non-hidden, non-task tool call', () => {
    const part = tc('Bash', 'b1', 'done');
    const result = groupToolCallParts([part]);
    expect(result).toEqual([part]);
  });

  it('passes through a single explore tool without grouping', () => {
    const part = tc('Read', 'r1', 'file content');
    const result = groupToolCallParts([part]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(part);
  });

  it('groups 2+ consecutive explore tools into a _ToolGroup', () => {
    const parts = [tc('Read', 'r1'), tc('Grep', 'g1'), tc('Glob', 'gl1')];
    const result = groupToolCallParts(parts);

    expect(result).toHaveLength(1);
    const group = result[0]!;
    expect(group.type).toBe('tool-call');
    if (group.type !== 'tool-call') throw new Error('not tool-call');
    expect(group.toolName).toBe('_ToolGroup');
    expect(group.toolCallId).toBe('r1');
    expect(group.result).toBe('grouped');

    const items = group.args.items as ToolGroupItem[];
    expect(items).toHaveLength(3);
    expect(items[0]!.toolName).toBe('Read');
    expect(items[1]!.toolName).toBe('Grep');
    expect(items[2]!.toolName).toBe('Glob');
  });

  it('does not group a single explore tool (needs >= 2)', () => {
    const parts = [tc('Read', 'r1')];
    const result = groupToolCallParts(parts);
    expect(result).toHaveLength(1);
    expect((result[0] as PartEntry & { type: 'tool-call' }).toolName).toBe('Read');
  });

  it('removes hidden tools from output', () => {
    const parts = [tc('TodoWrite', 'h1'), tc('Bash', 'b1')];
    const result = groupToolCallParts(parts);
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
    const result = groupToolCallParts(parts);
    expect(result).toEqual([]);
  });

  it('accumulates task progress tools into a single _TaskProgress entry', () => {
    const parts = [tc('TaskCreate', 'tc1'), tc('TaskUpdate', 'tu1')];
    const result = groupToolCallParts(parts);

    expect(result).toHaveLength(1);
    const entry = result[0]!;
    if (entry.type !== 'tool-call') throw new Error('expected tool-call');
    expect(entry.toolName).toBe('_TaskProgress');
    expect(entry.toolCallId).toBe('tc1');
    expect(entry.result).toBe('accumulated');

    const items = entry.args.items as TaskProgressItem[];
    expect(items).toHaveLength(2);
    expect(items[0]!.toolName).toBe('TaskCreate');
    expect(items[1]!.toolName).toBe('TaskUpdate');
  });

  it('places _TaskProgress at the position of the first task tool', () => {
    const parts = [tc('Bash', 'b1'), tc('TaskCreate', 'tc1'), tc('Edit', 'e1'), tc('TaskUpdate', 'tu1')];
    const result = groupToolCallParts(parts);

    // Bash at index 0, _TaskProgress at index 1, Edit at index 2
    expect(result).toHaveLength(3);
    expect((result[0] as PartEntry & { type: 'tool-call' }).toolName).toBe('Bash');
    expect((result[1] as PartEntry & { type: 'tool-call' }).toolName).toBe('_TaskProgress');
    expect((result[2] as PartEntry & { type: 'tool-call' }).toolName).toBe('Edit');
  });

  it('skips hidden tools interspersed between explore tools when grouping', () => {
    // Read, TodoWrite (hidden), Grep should still group Read+Grep
    const parts = [tc('Read', 'r1'), tc('TodoWrite', 'h1'), tc('Grep', 'g1')];
    const result = groupToolCallParts(parts);

    expect(result).toHaveLength(1);
    const group = result[0]!;
    if (group.type !== 'tool-call') throw new Error('expected tool-call');
    expect(group.toolName).toBe('_ToolGroup');
    const items = group.args.items as ToolGroupItem[];
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
    const result = groupToolCallParts(parts);

    // Read+Glob are grouped; TaskCreate is consumed by the inner explore loop
    const toolGroup = result.find(
      (p) => p.type === 'tool-call' && (p as PartEntry & { type: 'tool-call' }).toolName === '_ToolGroup',
    );
    expect(toolGroup).toBeDefined();
    const items = (toolGroup as PartEntry & { type: 'tool-call' }).args.items as ToolGroupItem[];
    expect(items).toHaveLength(2);
    expect(items[0]!.toolName).toBe('Read');
    expect(items[1]!.toolName).toBe('Glob');
  });

  it('breaks explore group on a non-explore, non-hidden, non-task tool', () => {
    const parts = [tc('Read', 'r1'), tc('Bash', 'b1'), tc('Grep', 'g1')];
    const result = groupToolCallParts(parts);

    // Read alone (no group), Bash, Grep alone (no group)
    expect(result).toHaveLength(3);
    expect((result[0] as PartEntry & { type: 'tool-call' }).toolName).toBe('Read');
    expect((result[1] as PartEntry & { type: 'tool-call' }).toolName).toBe('Bash');
    expect((result[2] as PartEntry & { type: 'tool-call' }).toolName).toBe('Grep');
  });

  it('breaks explore group on a text entry', () => {
    const parts = [tc('Read', 'r1'), text('thinking...'), tc('Grep', 'g1')];
    const result = groupToolCallParts(parts);

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
    const result = groupToolCallParts(parts);

    const names = result.map((p) =>
      p.type === 'text' ? `text:${p.text}` : `tool:${(p as PartEntry & { type: 'tool-call' }).toolName}`,
    );
    // The inner explore-grouping loop scans past TodoWrite (hidden) and TaskCreate
    // (task progress) without breaking the explore run, but also without adding
    // TaskCreate to the outer taskItems collector. So TaskCreate is consumed and
    // no _TaskProgress entry appears.
    expect(names).toEqual(['text:starting', 'tool:_ToolGroup', 'tool:Bash', 'text:done']);
  });

  it('produces _TaskProgress when task tools are NOT inside an explore run', () => {
    const parts = [tc('TaskCreate', 'tc1'), tc('Bash', 'b1'), tc('TaskUpdate', 'tu1')];
    const result = groupToolCallParts(parts);

    const names = result.map((p) =>
      p.type === 'text' ? `text:${p.text}` : `tool:${(p as PartEntry & { type: 'tool-call' }).toolName}`,
    );
    // _TaskProgress is inserted at position 0 (first task tool position), Bash at position 1
    expect(names).toEqual(['tool:_TaskProgress', 'tool:Bash']);
  });

  it('preserves tool call args and result through grouping', () => {
    const parts = [
      { type: 'tool-call' as const, toolCallId: 'r1', toolName: 'Read', args: { file: '/a.ts' }, result: 'content A' },
      { type: 'tool-call' as const, toolCallId: 'g1', toolName: 'Grep', args: { pattern: 'foo' }, result: 'match' },
    ];
    const result = groupToolCallParts(parts);
    const items = (result[0] as PartEntry & { type: 'tool-call' }).args.items as ToolGroupItem[];
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
    const result = groupToolCallParts(parts);
    const items = (result[0] as PartEntry & { type: 'tool-call' }).args.items as ToolGroupItem[];
    expect(items[0]!.isError).toBe(true);
    expect(items[1]!.isError).toBe(false);
  });
});

/* ── groupTaskChildren ───────────────────────────────────────────── */

describe('groupTaskChildren', () => {
  it('returns empty array for empty input', () => {
    expect(groupTaskChildren([])).toEqual([]);
  });

  it('passes through parts with no Task tool call', () => {
    const parts = [text('hello'), tc('Bash', 'b1'), text('done')];
    const result = groupTaskChildren(parts);
    expect(result).toEqual(parts);
  });

  it('wraps a Task + subsequent tool calls into a _TaskGroup', () => {
    const parts = [tc('Task', 't1', undefined), tc('Bash', 'b1', 'output'), tc('Read', 'r1', 'file')];
    const result = groupTaskChildren(parts);

    expect(result).toHaveLength(1);
    const group = result[0]!;
    if (group.type !== 'tool-call') throw new Error('expected tool-call');
    expect(group.toolName).toBe('_TaskGroup');
    expect(group.toolCallId).toBe('t1');

    const children = group.args.children as PartEntry[];
    expect(children).toHaveLength(2);
    expect(children[0]!).toEqual(tc('Bash', 'b1', 'output'));
    expect(children[1]!).toEqual(tc('Read', 'r1', 'file'));
  });

  it('preserves Task args in taskArgs', () => {
    const parts = [
      { type: 'tool-call' as const, toolCallId: 't1', toolName: 'Task', args: { description: 'do stuff' } },
      tc('Bash', 'b1'),
    ];
    const result = groupTaskChildren(parts);
    const group = result[0] as PartEntry & { type: 'tool-call' };
    expect(group.args.taskArgs).toEqual({ description: 'do stuff' });
  });

  it('stops grouping at a text entry', () => {
    const parts = [tc('Task', 't1'), tc('Bash', 'b1'), text('middle'), tc('Edit', 'e1')];
    const result = groupTaskChildren(parts);

    // _TaskGroup(Task+Bash), text, Edit
    expect(result).toHaveLength(3);
    expect((result[0] as PartEntry & { type: 'tool-call' }).toolName).toBe('_TaskGroup');
    expect(result[1]).toEqual(text('middle'));
    expect((result[2] as PartEntry & { type: 'tool-call' }).toolName).toBe('Edit');

    const children = (result[0] as PartEntry & { type: 'tool-call' }).args.children as PartEntry[];
    expect(children).toHaveLength(1);
    expect(children[0]!).toEqual(tc('Bash', 'b1'));
  });

  it('stops grouping at another Task tool call', () => {
    const parts = [tc('Task', 't1'), tc('Bash', 'b1'), tc('Task', 't2'), tc('Read', 'r1')];
    const result = groupTaskChildren(parts);

    expect(result).toHaveLength(2);
    expect((result[0] as PartEntry & { type: 'tool-call' }).toolName).toBe('_TaskGroup');
    expect((result[0] as PartEntry & { type: 'tool-call' }).toolCallId).toBe('t1');
    expect((result[1] as PartEntry & { type: 'tool-call' }).toolName).toBe('_TaskGroup');
    expect((result[1] as PartEntry & { type: 'tool-call' }).toolCallId).toBe('t2');

    const children1 = (result[0] as PartEntry & { type: 'tool-call' }).args.children as PartEntry[];
    expect(children1).toHaveLength(1);
    expect(children1[0]!).toEqual(tc('Bash', 'b1'));

    const children2 = (result[1] as PartEntry & { type: 'tool-call' }).args.children as PartEntry[];
    expect(children2).toHaveLength(1);
    expect(children2[0]!).toEqual(tc('Read', 'r1'));
  });

  it('leaves a Task with no children as a plain Task entry', () => {
    const parts = [tc('Task', 't1'), text('after')];
    const result = groupTaskChildren(parts);

    expect(result).toHaveLength(2);
    expect((result[0] as PartEntry & { type: 'tool-call' }).toolName).toBe('Task');
    expect(result[1]).toEqual(text('after'));
  });

  it('leaves a trailing Task with no children as a plain Task entry', () => {
    const parts = [text('before'), tc('Task', 't1')];
    const result = groupTaskChildren(parts);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(text('before'));
    expect((result[1] as PartEntry & { type: 'tool-call' }).toolName).toBe('Task');
  });

  it('preserves result and isError on _TaskGroup', () => {
    const parts = [
      { type: 'tool-call' as const, toolCallId: 't1', toolName: 'Task', args: {}, result: 'task done', isError: false },
      tc('Bash', 'b1'),
    ];
    const result = groupTaskChildren(parts);
    const group = result[0] as PartEntry & { type: 'tool-call' };
    expect(group.result).toBe('task done');
    expect(group.isError).toBe(false);
  });
});
