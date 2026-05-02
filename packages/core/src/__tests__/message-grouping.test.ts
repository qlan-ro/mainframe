import { describe, it, expect } from 'vitest';
import { groupTaskChildren, type PartEntry } from '../messages/tool-grouping.js';
import type { ToolCategories } from '@qlan-ro/mainframe-types';

function makeCategories(): ToolCategories {
  return {
    explore: new Set(['Read', 'Glob', 'Grep', 'LS']),
    hidden: new Set(['TodoWrite']),
    progress: new Set(['_TaskProgress']),
    subagent: new Set(['Agent', 'Task']),
  };
}

describe('groupTaskChildren', () => {
  it('includes text/thinking-sentinel/tool_call/skill_loaded children whose parentToolUseId matches the Agent id', () => {
    const cats = makeCategories();
    const parts: PartEntry[] = [
      { type: 'tool-call', toolCallId: 'toolu_agent_1', toolName: 'Agent', args: {}, result: 'ok' },
      { type: 'text', text: 'Run echo hi via Bash and report the output.', parentToolUseId: 'toolu_agent_1' },
      // Thinking arrives as a sentinel; the sentinel itself now carries the tag.
      { type: 'text', text: '\0ng:0', parentToolUseId: 'toolu_agent_1' },
      {
        type: 'tool-call',
        toolCallId: 'toolu_sub_bash',
        toolName: 'Bash',
        args: { command: 'echo hi' },
        result: 'hi',
        parentToolUseId: 'toolu_agent_1',
      },
    ];
    const grouped = groupTaskChildren(parts, cats);
    expect(grouped).toHaveLength(1);
    const g = grouped[0]!;
    expect(g.type).toBe('tool-call');
    expect((g as { toolName: string }).toolName).toBe('_TaskGroup');
    const args = (g as unknown as { args: { children: PartEntry[] } }).args;
    expect(args.children).toHaveLength(3);
    // First child is the dispatch prompt text
    expect(args.children[0]!.type).toBe('text');
    expect((args.children[0]! as { text: string }).text).toContain('Run echo hi');
    // Second child is the thinking sentinel — preserved for downstream decode
    expect((args.children[1]! as { text: string }).text).toBe('\0ng:0');
    // Third child is the Bash tool_call
    expect((args.children[2]! as { toolName?: string }).toolName).toBe('Bash');
  });

  it('stops collecting when a part has no parentToolUseId or a different one', () => {
    const cats = makeCategories();
    const parts: PartEntry[] = [
      { type: 'tool-call', toolCallId: 'toolu_agent_1', toolName: 'Agent', args: {}, result: 'ok' },
      { type: 'text', text: 'subagent text', parentToolUseId: 'toolu_agent_1' },
      { type: 'tool-call', toolCallId: 'toolu_sub_bash', toolName: 'Bash', args: {}, parentToolUseId: 'toolu_agent_1' },
      { type: 'text', text: 'parent thread text' }, // no parentToolUseId — terminates the group
      { type: 'tool-call', toolCallId: 'toolu_parent_read', toolName: 'Read', args: {} },
    ];
    const grouped = groupTaskChildren(parts, cats);
    expect(grouped).toHaveLength(3);
    expect((grouped[0] as { toolName: string }).toolName).toBe('_TaskGroup');
    expect(grouped[1]!.type).toBe('text');
    expect((grouped[1]! as { text: string }).text).toBe('parent thread text');
    expect((grouped[2] as { toolName: string }).toolName).toBe('Read');
  });

  it('still groups tool_call children when no text parts intervene (back-compat with existing flow)', () => {
    const cats = makeCategories();
    const parts: PartEntry[] = [
      { type: 'tool-call', toolCallId: 'toolu_agent_1', toolName: 'Agent', args: {}, result: 'ok' },
      { type: 'tool-call', toolCallId: 'toolu_sub_bash', toolName: 'Bash', args: {}, parentToolUseId: 'toolu_agent_1' },
      { type: 'tool-call', toolCallId: 'toolu_sub_read', toolName: 'Read', args: {}, parentToolUseId: 'toolu_agent_1' },
    ];
    const grouped = groupTaskChildren(parts, cats);
    expect(grouped).toHaveLength(1);
    const args = (grouped[0] as unknown as { args: { children: PartEntry[] } }).args;
    expect(args.children).toHaveLength(2);
  });

  it('terminates on a second Agent tool_call (parallel subagents)', () => {
    const cats = makeCategories();
    const parts: PartEntry[] = [
      { type: 'tool-call', toolCallId: 'toolu_agent_1', toolName: 'Agent', args: {}, result: 'ok' },
      { type: 'text', text: 'first prompt', parentToolUseId: 'toolu_agent_1' },
      { type: 'tool-call', toolCallId: 'toolu_agent_2', toolName: 'Agent', args: {}, result: 'ok2' },
      { type: 'text', text: 'second prompt', parentToolUseId: 'toolu_agent_2' },
    ];
    const grouped = groupTaskChildren(parts, cats);
    expect(grouped).toHaveLength(2);
    expect((grouped[0] as { toolName: string }).toolName).toBe('_TaskGroup');
    expect((grouped[1] as { toolName: string }).toolName).toBe('_TaskGroup');
    const firstArgs = (grouped[0] as unknown as { args: { children: PartEntry[] } }).args;
    const secondArgs = (grouped[1] as unknown as { args: { children: PartEntry[] } }).args;
    expect(firstArgs.children).toHaveLength(1);
    expect((firstArgs.children[0] as { text: string }).text).toBe('first prompt');
    expect(secondArgs.children).toHaveLength(1);
    expect((secondArgs.children[0] as { text: string }).text).toBe('second prompt');
  });

  it('Agent with no matching children renders as a plain tool-call (not _TaskGroup)', () => {
    const cats = makeCategories();
    const parts: PartEntry[] = [
      { type: 'tool-call', toolCallId: 'toolu_agent_1', toolName: 'Agent', args: {}, result: 'ok' },
      { type: 'text', text: 'untagged' /* no parentToolUseId */ },
    ];
    const grouped = groupTaskChildren(parts, cats);
    expect(grouped).toHaveLength(2);
    expect((grouped[0] as { toolName: string }).toolName).toBe('Agent');
    expect(grouped[1]!.type).toBe('text');
  });
});
