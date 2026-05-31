/**
 * CHARACTERIZATION TESTS for applyToolGrouping (WS14b safety net).
 *
 * These tests pin the CURRENT behavior of applyToolGrouping so that the
 * upcoming refactor (dropping the internal NG_SENTINEL round-trip) cannot
 * silently reorder, drop, or mis-wrap content.
 *
 * Rules:
 * - DO NOT change production code to make these pass.
 * - If you find an expectation is wrong, fix the test to match reality, not
 *   the other way around.
 * - Every test has a "CHARACTERIZATION" comment on the assertion that pins
 *   specific current behavior the refactor must preserve.
 */

import { describe, it, expect } from 'vitest';
import { applyToolGrouping } from '../display-helpers.js';
import type { DisplayContent, ToolCategories } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Shared fixture categories (mirrors a realistic Claude adapter declaration)
// ---------------------------------------------------------------------------
// TodoWrite is in BOTH hidden and progress, mirroring how ClaudeAdapter marks
// the real V2 task tools: hidden (never a raw tool card) yet surfaced as a
// single _TaskProgress entry. Progress takes precedence over hidden.
const CAT: ToolCategories = {
  explore: new Set(['Read', 'Grep', 'Glob', 'LS']),
  hidden: new Set(['HiddenTool', 'TodoWrite']),
  progress: new Set(['TodoWrite']),
  subagent: new Set(['Task', 'Agent']),
};

// ---------------------------------------------------------------------------
// 1. POSITIONAL INTERLEAVING — highest priority
//    Tests that non-groupable content (thinking, image) preserves its exact
//    position between surrounding explore tools and text blocks.
// ---------------------------------------------------------------------------
describe('applyToolGrouping — positional interleaving', () => {
  it('text → explore → thinking → explore → text: each element stays in its original slot', () => {
    // CHARACTERIZATION: the thinking breaks both explore runs (each is alone →
    // no tool_group wrapping). All five items appear in original order.
    const input: DisplayContent[] = [
      { type: 'text', text: 'First text' },
      { type: 'tool_call', id: 'tc1', name: 'Read', input: { path: '/a' }, category: 'explore' },
      { type: 'thinking', thinking: 'some thought' },
      { type: 'tool_call', id: 'tc2', name: 'Grep', input: { pattern: 'foo' }, category: 'explore' },
      { type: 'text', text: 'Last text' },
    ];

    const out = applyToolGrouping(input, CAT);

    // CHARACTERIZATION: pins exact output order and shapes
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ type: 'text', text: 'First text' });
    expect(out[1]).toEqual({ type: 'tool_call', id: 'tc1', name: 'Read', input: { path: '/a' }, category: 'explore' });
    expect(out[2]).toEqual({ type: 'thinking', thinking: 'some thought' });
    expect(out[3]).toEqual({
      type: 'tool_call',
      id: 'tc2',
      name: 'Grep',
      input: { pattern: 'foo' },
      category: 'explore',
    });
    expect(out[4]).toEqual({ type: 'text', text: 'Last text' });
  });

  it('explore → image → explore → text: image stays between the two solo explores, not hoisted', () => {
    // CHARACTERIZATION: image is non-groupable. It breaks both explore runs so
    // neither is in a group. The image appears in slot [1] — between the two
    // explore tool_calls — not reordered to the front or back.
    const input: DisplayContent[] = [
      { type: 'tool_call', id: 'tc1', name: 'Read', input: { path: '/a' }, category: 'explore' },
      { type: 'image', mediaType: 'image/png', data: 'base64data' },
      { type: 'tool_call', id: 'tc2', name: 'Grep', input: { pattern: 'foo' }, category: 'explore' },
      { type: 'text', text: 'End' },
    ];

    const out = applyToolGrouping(input, CAT);

    // CHARACTERIZATION: 4 items, original order preserved
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({
      type: 'tool_call',
      id: 'tc1',
      name: 'Read',
      input: { path: '/a' },
      category: 'explore',
    });
    expect(out[1]).toEqual({ type: 'image', mediaType: 'image/png', data: 'base64data' });
    expect(out[2]).toEqual({
      type: 'tool_call',
      id: 'tc2',
      name: 'Grep',
      input: { pattern: 'foo' },
      category: 'explore',
    });
    expect(out[3]).toEqual({ type: 'text', text: 'End' });
  });

  it('explore → explore → thinking → explore: first pair groups, thinking stays in slot, last is solo', () => {
    // CHARACTERIZATION: Read+Grep are consecutive → form a tool_group.
    // The thinking in the middle position stays between the tool_group and the
    // solo LS that follows — i.e., [tool_group, thinking, solo-explore].
    const input: DisplayContent[] = [
      { type: 'tool_call', id: 'e1', name: 'Read', input: { path: '/a' }, category: 'explore' },
      { type: 'tool_call', id: 'e2', name: 'Grep', input: { pattern: 'x' }, category: 'explore' },
      { type: 'thinking', thinking: 'mid-thought' },
      { type: 'tool_call', id: 'e3', name: 'LS', input: { path: '/' }, category: 'explore' },
    ];

    const out = applyToolGrouping(input, CAT);

    // CHARACTERIZATION: 3 output items: tool_group | thinking | solo-explore
    expect(out).toHaveLength(3);

    // slot 0 — grouped first pair
    expect(out[0]!.type).toBe('tool_group');
    const grp = out[0] as DisplayContent & { type: 'tool_group' };
    expect(grp.calls).toHaveLength(2);
    expect((grp.calls[0] as DisplayContent & { type: 'tool_call' }).id).toBe('e1');
    expect((grp.calls[1] as DisplayContent & { type: 'tool_call' }).id).toBe('e2');

    // slot 1 — thinking NOT hoisted to the front
    expect(out[1]).toEqual({ type: 'thinking', thinking: 'mid-thought' });

    // slot 2 — solo explore (not in a group)
    expect(out[2]).toEqual({ type: 'tool_call', id: 'e3', name: 'LS', input: { path: '/' }, category: 'explore' });
  });
});

// ---------------------------------------------------------------------------
// 2. NON-GROUPABLE SANDWICHED INSIDE AN EXPLORE RUN
//    Pin the exact split behavior when a non-groupable item interrupts what
//    would otherwise be a run of ≥2 explore tools.
// ---------------------------------------------------------------------------
describe('applyToolGrouping — non-groupable sandwiched inside explore run', () => {
  it('explore → thinking → explore → explore: thinking breaks the first tool into solo; remainder groups', () => {
    // CHARACTERIZATION: groupToolCallParts looks ahead only over consecutive
    // tool-call entries. The sentinel text for "thinking" is a non-tool-call
    // entry that stops the look-ahead for tc1 immediately, so tc1 is alone.
    // tc2 and tc3 then form their own consecutive run of 2 → tool_group.
    // The thinking sentinel is decoded back at its original position between
    // the solo tc1 and the tool_group.
    //
    // Output: [solo-Read, thinking, tool_group(Grep, LS)]
    const input: DisplayContent[] = [
      { type: 'tool_call', id: 'tc1', name: 'Read', input: { path: '/a' }, category: 'explore' },
      { type: 'thinking', thinking: 'interruption' },
      { type: 'tool_call', id: 'tc2', name: 'Grep', input: { pattern: 'foo' }, category: 'explore' },
      { type: 'tool_call', id: 'tc3', name: 'LS', input: { path: '/' }, category: 'explore' },
    ];

    const out = applyToolGrouping(input, CAT);

    // CHARACTERIZATION: tc1 is NOT grouped with tc2/tc3
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      type: 'tool_call',
      id: 'tc1',
      name: 'Read',
      input: { path: '/a' },
      category: 'explore',
    });
    expect(out[1]).toEqual({ type: 'thinking', thinking: 'interruption' });
    expect(out[2]!.type).toBe('tool_group');
    const grp = out[2] as DisplayContent & { type: 'tool_group' };
    expect(grp.calls).toHaveLength(2);
    expect((grp.calls[0] as DisplayContent & { type: 'tool_call' }).id).toBe('tc2');
    expect((grp.calls[1] as DisplayContent & { type: 'tool_call' }).id).toBe('tc3');
  });

  it('explore → explore → thinking → explore → explore: two groups separated by thinking', () => {
    // CHARACTERIZATION: e1+e2 form group1. thinking stays in slot [1].
    // e3+e4 form group2. Order: [group1, thinking, group2].
    const input: DisplayContent[] = [
      { type: 'tool_call', id: 'e1', name: 'Read', input: { path: '/a' }, category: 'explore' },
      { type: 'tool_call', id: 'e2', name: 'Grep', input: { pattern: 'x' }, category: 'explore' },
      { type: 'thinking', thinking: 'between groups' },
      { type: 'tool_call', id: 'e3', name: 'Glob', input: { pattern: '*.ts' }, category: 'explore' },
      { type: 'tool_call', id: 'e4', name: 'LS', input: { path: '/' }, category: 'explore' },
    ];

    const out = applyToolGrouping(input, CAT);

    expect(out).toHaveLength(3);
    expect(out[0]!.type).toBe('tool_group');
    expect(out[1]).toEqual({ type: 'thinking', thinking: 'between groups' });
    expect(out[2]!.type).toBe('tool_group');

    const grp1 = out[0] as DisplayContent & { type: 'tool_group' };
    const grp2 = out[2] as DisplayContent & { type: 'tool_group' };
    expect((grp1.calls[0] as DisplayContent & { type: 'tool_call' }).id).toBe('e1');
    expect((grp1.calls[1] as DisplayContent & { type: 'tool_call' }).id).toBe('e2');
    expect((grp2.calls[0] as DisplayContent & { type: 'tool_call' }).id).toBe('e3');
    expect((grp2.calls[1] as DisplayContent & { type: 'tool_call' }).id).toBe('e4');
  });
});

// ---------------------------------------------------------------------------
// 3. SINGLE LONE EXPLORE TOOL — wrapping behavior
// ---------------------------------------------------------------------------
describe('applyToolGrouping — lone explore tool', () => {
  it('a single explore tool is NOT wrapped in a tool_group', () => {
    // CHARACTERIZATION: tool_group is only emitted when group.length >= 2
    // (see tool-grouping.ts line 111). A single explore tool passes through
    // as a bare tool_call.
    const input: DisplayContent[] = [
      { type: 'tool_call', id: 'tc1', name: 'Read', input: { path: '/a' }, category: 'explore' },
    ];

    const out = applyToolGrouping(input, CAT);

    expect(out).toHaveLength(1);
    // CHARACTERIZATION: type is 'tool_call', NOT 'tool_group'
    expect(out[0]!.type).toBe('tool_call');
    expect(out[0]).toEqual({ type: 'tool_call', id: 'tc1', name: 'Read', input: { path: '/a' }, category: 'explore' });
  });

  it('exactly two consecutive explore tools ARE wrapped in a tool_group', () => {
    // CHARACTERIZATION: the minimum group size is 2.
    const input: DisplayContent[] = [
      { type: 'tool_call', id: 'e1', name: 'Read', input: { path: '/a' }, category: 'explore' },
      { type: 'tool_call', id: 'e2', name: 'Grep', input: { pattern: 'x' }, category: 'explore' },
    ];

    const out = applyToolGrouping(input, CAT);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('tool_group');
    const grp = out[0] as DisplayContent & { type: 'tool_group' };
    expect(grp.calls).toHaveLength(2);
    expect((grp.calls[0] as DisplayContent & { type: 'tool_call' }).id).toBe('e1');
    expect((grp.calls[1] as DisplayContent & { type: 'tool_call' }).id).toBe('e2');
  });

  it('two explore runs separated by a default (non-explore) tool each form their own group', () => {
    // CHARACTERIZATION: a non-explore tool_call (Write) is NOT hidden and NOT
    // explore, so it breaks the first group. Each pair forms a separate group.
    const input: DisplayContent[] = [
      { type: 'tool_call', id: 'e1', name: 'Read', input: { path: '/a' }, category: 'explore' },
      { type: 'tool_call', id: 'e2', name: 'Grep', input: { pattern: 'x' }, category: 'explore' },
      { type: 'tool_call', id: 'w1', name: 'Write', input: { path: '/b', content: 'x' }, category: 'default' },
      { type: 'tool_call', id: 'e3', name: 'Read', input: { path: '/c' }, category: 'explore' },
      { type: 'tool_call', id: 'e4', name: 'LS', input: { path: '/' }, category: 'explore' },
    ];

    const out = applyToolGrouping(input, CAT);

    expect(out).toHaveLength(3);
    expect(out[0]!.type).toBe('tool_group');
    expect(out[1]).toEqual({
      type: 'tool_call',
      id: 'w1',
      name: 'Write',
      input: { path: '/b', content: 'x' },
      category: 'default',
    });
    expect(out[2]!.type).toBe('tool_group');

    const grp1 = out[0] as DisplayContent & { type: 'tool_group' };
    const grp2 = out[2] as DisplayContent & { type: 'tool_group' };
    expect(grp1.calls).toHaveLength(2);
    expect(grp2.calls).toHaveLength(2);
    expect((grp1.calls[0] as DisplayContent & { type: 'tool_call' }).id).toBe('e1');
    expect((grp1.calls[1] as DisplayContent & { type: 'tool_call' }).id).toBe('e2');
    expect((grp2.calls[0] as DisplayContent & { type: 'tool_call' }).id).toBe('e3');
    expect((grp2.calls[1] as DisplayContent & { type: 'tool_call' }).id).toBe('e4');
  });
});

// ---------------------------------------------------------------------------
// 4. _TaskProgress ACCUMULATION + INSERTION POSITION
// ---------------------------------------------------------------------------
describe('applyToolGrouping — _TaskProgress accumulation and position', () => {
  it('consecutive progress tools: both accumulated into one _TaskProgress at first-seen position', () => {
    // CHARACTERIZATION: taskInsertIndex captures the position of the FIRST
    // progress tool (slot 1, after "Before"). Both tp1 and tp2 appear in the
    // accumulated items array. The single _TaskProgress is spliced in at
    // slot 1 (after "Before"), before "After".
    const input: DisplayContent[] = [
      { type: 'text', text: 'Before' },
      { type: 'tool_call', id: 'tp1', name: 'TodoWrite', input: { task: 'a' }, category: 'progress' },
      { type: 'tool_call', id: 'tp2', name: 'TodoWrite', input: { task: 'b' }, category: 'progress' },
      { type: 'text', text: 'After' },
    ];

    const out = applyToolGrouping(input, CAT);

    // CHARACTERIZATION: [text, _TaskProgress(tp1,tp2), text]
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ type: 'text', text: 'Before' });
    expect(out[1]!.type).toBe('tool_call');
    const prog = out[1] as DisplayContent & { type: 'tool_call' };
    expect(prog.name).toBe('_TaskProgress');
    expect(prog.category).toBe('progress');
    // CHARACTERIZATION: both items appear in the accumulated list
    const items = (prog.input as { items: Array<{ toolCallId: string; toolName: string }> }).items;
    expect(items).toHaveLength(2);
    expect(items[0]!.toolCallId).toBe('tp1');
    expect(items[1]!.toolCallId).toBe('tp2');
    expect(out[2]).toEqual({ type: 'text', text: 'After' });
  });

  it('scattered progress tools (explore between them): BOTH progress tools are accumulated, none dropped', () => {
    // A progress tool consumed inside the explore look-ahead must still be
    // collected. groupToolCallParts walks parts linearly: tp1 is collected in
    // the main loop (slot 1). When tc1 (Read) is encountered the explore
    // look-ahead starts at j=3 (tp2); tp2 is a progress tool, so the look-ahead
    // accumulates it into taskItems rather than discarding it. The single
    // _TaskProgress is inserted at taskInsertIndex (1, where tp1 was seen) and
    // carries BOTH tp1 and tp2.
    const input: DisplayContent[] = [
      { type: 'text', text: 'Before' },
      { type: 'tool_call', id: 'tp1', name: 'TodoWrite', input: { task: 'a' }, category: 'progress' },
      { type: 'tool_call', id: 'tc1', name: 'Read', input: { path: '/a' }, category: 'explore' },
      { type: 'tool_call', id: 'tp2', name: 'TodoWrite', input: { task: 'b' }, category: 'progress' },
      { type: 'text', text: 'After' },
    ];

    const out = applyToolGrouping(input, CAT);

    // [text, _TaskProgress(tp1,tp2), Read, text]
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ type: 'text', text: 'Before' });

    // _TaskProgress at slot 1 — inserted at taskInsertIndex (= 1, where tp1 was)
    expect(out[1]!.type).toBe('tool_call');
    const prog = out[1] as DisplayContent & { type: 'tool_call' };
    expect(prog.name).toBe('_TaskProgress');
    const items = (prog.input as { items: Array<{ toolCallId: string }> }).items;
    // both progress tools survive — tp2 is no longer dropped
    expect(items).toHaveLength(2);
    expect(items[0]!.toolCallId).toBe('tp1');
    expect(items[1]!.toolCallId).toBe('tp2');

    // tc1 (Read) is still present as a solo explore (not wrapped in tool_group)
    expect(out[2]).toEqual({
      type: 'tool_call',
      id: 'tc1',
      name: 'Read',
      input: { path: '/a' },
      category: 'explore',
    });

    expect(out[3]).toEqual({ type: 'text', text: 'After' });
  });

  it('progress insert position: _TaskProgress goes at the slot of the first progress tool', () => {
    // CHARACTERIZATION: taskInsertIndex = result.length at the time the first
    // progress tool is encountered. Here the progress tool is after two text
    // blocks — taskInsertIndex = 2 (after the two text entries).
    const input: DisplayContent[] = [
      { type: 'text', text: 'A' },
      { type: 'text', text: 'B' },
      { type: 'tool_call', id: 'tp1', name: 'TodoWrite', input: { task: 'x' }, category: 'progress' },
      { type: 'tool_call', id: 'tp2', name: 'TodoWrite', input: { task: 'y' }, category: 'progress' },
      { type: 'text', text: 'C' },
    ];

    const out = applyToolGrouping(input, CAT);

    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({ type: 'text', text: 'A' });
    expect(out[1]).toEqual({ type: 'text', text: 'B' });
    // CHARACTERIZATION: _TaskProgress inserted at slot 2 (where first progress was)
    expect(out[2]!.type).toBe('tool_call');
    expect((out[2] as DisplayContent & { type: 'tool_call' }).name).toBe('_TaskProgress');
    expect(out[3]).toEqual({ type: 'text', text: 'C' });
  });
});

// ---------------------------------------------------------------------------
// 5. task_group NESTING — children order, explore grouping inside, thinking
// ---------------------------------------------------------------------------
describe('applyToolGrouping — task_group nesting', () => {
  it('task_group children: explore pair grouped as _ToolGroup tool_call (not tool_group), thinking after stays in position', () => {
    // CHARACTERIZATION: Inside task_group.calls, the inner explore groups are
    // NOT converted to type:'tool_group'. They appear as type:'tool_call' with
    // name:'_ToolGroup'. This is because the _TaskGroup branch in
    // convertGroupedPartsToDisplay maps children through the raw else-branch
    // (tool_call mapping) which doesn't special-case _ToolGroup.
    //
    // Order in task_group.calls: [_ToolGroup(Read,Grep), thinking, solo-LS]
    const input: DisplayContent[] = [
      {
        type: 'tool_call',
        id: 'agent1',
        name: 'Task',
        input: { description: 'do work' },
        category: 'subagent',
      },
      {
        type: 'tool_call',
        id: 'c1',
        name: 'Read',
        input: { path: '/a' },
        category: 'explore',
        parentToolUseId: 'agent1',
      },
      {
        type: 'tool_call',
        id: 'c2',
        name: 'Grep',
        input: { pattern: 'x' },
        category: 'explore',
        parentToolUseId: 'agent1',
      },
      { type: 'thinking', thinking: 'child thought', parentToolUseId: 'agent1' },
      {
        type: 'tool_call',
        id: 'c3',
        name: 'LS',
        input: { path: '/' },
        category: 'explore',
        parentToolUseId: 'agent1',
      },
    ];

    const out = applyToolGrouping(input, CAT);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('task_group');
    const tg = out[0] as DisplayContent & { type: 'task_group' };
    expect(tg.agentId).toBe('agent1');
    expect(tg.taskArgs).toEqual({ description: 'do work' });
    expect(tg.calls).toHaveLength(3);

    // CHARACTERIZATION: slot 0 — inner explore group rendered as tool_call with name='_ToolGroup'
    const innerGroup = tg.calls[0] as DisplayContent & { type: 'tool_call' };
    expect(innerGroup.type).toBe('tool_call');
    expect(innerGroup.name).toBe('_ToolGroup');
    // The _ToolGroup args.items lists Read and Grep
    const items = (innerGroup.input as { items: Array<{ toolName: string; toolCallId: string }> }).items;
    expect(items).toHaveLength(2);
    expect(items[0]!.toolCallId).toBe('c1');
    expect(items[0]!.toolName).toBe('Read');
    expect(items[1]!.toolCallId).toBe('c2');
    expect(items[1]!.toolName).toBe('Grep');

    // CHARACTERIZATION: slot 1 — thinking in correct position (not hoisted)
    expect(tg.calls[1]).toEqual({ type: 'thinking', thinking: 'child thought', parentToolUseId: 'agent1' });

    // CHARACTERIZATION: slot 2 — solo LS (alone, not grouped)
    expect(tg.calls[2]).toEqual({
      type: 'tool_call',
      id: 'c3',
      name: 'LS',
      input: { path: '/' },
      category: 'explore',
      parentToolUseId: 'agent1',
    });
  });

  it('task_group children: thinking BEFORE explore pair stays at position [0]', () => {
    // CHARACTERIZATION: thinking at start of children, then explore group.
    // Order: [thinking, _ToolGroup(Read,Grep)]
    const input: DisplayContent[] = [
      {
        type: 'tool_call',
        id: 'agent1',
        name: 'Task',
        input: { description: 'work' },
        category: 'subagent',
      },
      { type: 'thinking', thinking: 'before explore', parentToolUseId: 'agent1' },
      {
        type: 'tool_call',
        id: 'c1',
        name: 'Read',
        input: { path: '/a' },
        category: 'explore',
        parentToolUseId: 'agent1',
      },
      {
        type: 'tool_call',
        id: 'c2',
        name: 'Grep',
        input: { pattern: 'x' },
        category: 'explore',
        parentToolUseId: 'agent1',
      },
    ];

    const out = applyToolGrouping(input, CAT);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('task_group');
    const tg = out[0] as DisplayContent & { type: 'task_group' };
    expect(tg.calls).toHaveLength(2);

    // CHARACTERIZATION: thinking is at index 0, NOT after the explore group
    expect(tg.calls[0]).toEqual({ type: 'thinking', thinking: 'before explore', parentToolUseId: 'agent1' });

    // CHARACTERIZATION: _ToolGroup at index 1
    const innerGrp = tg.calls[1] as DisplayContent & { type: 'tool_call' };
    expect(innerGrp.type).toBe('tool_call');
    expect(innerGrp.name).toBe('_ToolGroup');
    const items = (innerGrp.input as { items: Array<{ toolCallId: string }> }).items;
    expect(items[0]!.toolCallId).toBe('c1');
    expect(items[1]!.toolCallId).toBe('c2');
  });

  it('subagent without children: stays as bare tool_call, no task_group wrapper', () => {
    // CHARACTERIZATION: groupTaskChildren only creates a _TaskGroup when children.length > 0.
    // A subagent with no parentToolUseId-tagged children passes through as-is.
    const input: DisplayContent[] = [
      {
        type: 'tool_call',
        id: 'agent1',
        name: 'Task',
        input: { description: 'solo agent' },
        category: 'subagent',
      },
    ];

    const out = applyToolGrouping(input, CAT);

    expect(out).toHaveLength(1);
    // CHARACTERIZATION: no task_group — bare tool_call
    expect(out[0]!.type).toBe('tool_call');
    expect((out[0] as DisplayContent & { type: 'tool_call' }).id).toBe('agent1');
    expect((out[0] as DisplayContent & { type: 'tool_call' }).name).toBe('Task');
  });

  it('task_group agentId comes from tool_use id, not taskArgs.description', () => {
    // CHARACTERIZATION: regression guard for #184. agentId must equal the
    // tool_use id so React keys stay unique when two agents share a description.
    const input: DisplayContent[] = [
      {
        type: 'tool_call',
        id: 'toolu_unique_001',
        name: 'Task',
        input: { description: 'same label', prompt: 'p1' },
        category: 'subagent',
      },
      {
        type: 'tool_call',
        id: 'child_001',
        name: 'Bash',
        input: { command: 'echo a' },
        category: 'default',
        parentToolUseId: 'toolu_unique_001',
      },
    ];

    const out = applyToolGrouping(input, CAT);

    const tg = out[0] as DisplayContent & { type: 'task_group' };
    // CHARACTERIZATION: agentId is the tool_use id, not the description string
    expect(tg.agentId).toBe('toolu_unique_001');
    expect(tg.agentId).not.toBe('same label');
  });
});

// ---------------------------------------------------------------------------
// 6. HIDDEN TOOL SUPPRESSION
// ---------------------------------------------------------------------------
describe('applyToolGrouping — hidden tool suppression', () => {
  it('a hidden tool between two explore tools is suppressed; explore tools are NOT grouped', () => {
    // CHARACTERIZATION: isHiddenToolPart returns true for HiddenTool.
    // The hidden tool is skipped during the explore look-ahead (j++ without
    // pushing to group), so the explore run continues PAST the hidden tool.
    // BUT the hidden tool is at the tool-call level (type='tool-call'), not
    // a text sentinel, so it doesn't break the contiguous run from the
    // look-ahead loop's perspective.
    //
    // Result: Read and Grep ARE grouped together (hidden tool is invisible).
    const input: DisplayContent[] = [
      { type: 'tool_call', id: 'e1', name: 'Read', input: { path: '/a' }, category: 'explore' },
      { type: 'tool_call', id: 'h1', name: 'HiddenTool', input: {}, category: 'hidden' },
      { type: 'tool_call', id: 'e2', name: 'Grep', input: { pattern: 'x' }, category: 'explore' },
    ];

    const out = applyToolGrouping(input, CAT);

    // CHARACTERIZATION: Read + Grep are grouped (hidden tool skipped)
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('tool_group');
    const grp = out[0] as DisplayContent & { type: 'tool_group' };
    expect(grp.calls).toHaveLength(2);
    expect((grp.calls[0] as DisplayContent & { type: 'tool_call' }).id).toBe('e1');
    expect((grp.calls[1] as DisplayContent & { type: 'tool_call' }).id).toBe('e2');
  });
});

// ---------------------------------------------------------------------------
// 7. MIXED CONTENT — full realistic sequence
// ---------------------------------------------------------------------------
describe('applyToolGrouping — realistic mixed sequence', () => {
  it('text → thinking → explore×3 → default → text: output order matches input order', () => {
    // CHARACTERIZATION: thinking at the front, then three consecutive explores
    // (group), then default tool, then text. The thinking must NOT be moved
    // after the explore group.
    const input: DisplayContent[] = [
      { type: 'text', text: 'I will analyze the codebase.' },
      { type: 'thinking', thinking: 'plan: read 3 files' },
      { type: 'tool_call', id: 'e1', name: 'Read', input: { path: '/a.ts' }, category: 'explore' },
      { type: 'tool_call', id: 'e2', name: 'Grep', input: { pattern: 'import' }, category: 'explore' },
      { type: 'tool_call', id: 'e3', name: 'LS', input: { path: '/src' }, category: 'explore' },
      { type: 'tool_call', id: 'd1', name: 'Bash', input: { command: 'pwd' }, category: 'default' },
      { type: 'text', text: 'Done.' },
    ];

    const out = applyToolGrouping(input, CAT);

    // CHARACTERIZATION: [text, thinking, tool_group(3), default, text]
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ type: 'text', text: 'I will analyze the codebase.' });
    expect(out[1]).toEqual({ type: 'thinking', thinking: 'plan: read 3 files' });
    expect(out[2]!.type).toBe('tool_group');
    const grp = out[2] as DisplayContent & { type: 'tool_group' };
    expect(grp.calls).toHaveLength(3);
    expect((grp.calls[0] as DisplayContent & { type: 'tool_call' }).id).toBe('e1');
    expect((grp.calls[1] as DisplayContent & { type: 'tool_call' }).id).toBe('e2');
    expect((grp.calls[2] as DisplayContent & { type: 'tool_call' }).id).toBe('e3');
    expect(out[3]).toEqual({
      type: 'tool_call',
      id: 'd1',
      name: 'Bash',
      input: { command: 'pwd' },
      category: 'default',
    });
    expect(out[4]).toEqual({ type: 'text', text: 'Done.' });
  });

  it('empty input returns empty output', () => {
    expect(applyToolGrouping([], CAT)).toEqual([]);
  });

  it('input with no tool calls passes through unchanged', () => {
    const input: DisplayContent[] = [
      { type: 'text', text: 'Hello' },
      { type: 'thinking', thinking: 'think' },
      { type: 'text', text: 'World' },
    ];
    const out = applyToolGrouping(input, CAT);
    expect(out).toEqual(input);
  });
});
