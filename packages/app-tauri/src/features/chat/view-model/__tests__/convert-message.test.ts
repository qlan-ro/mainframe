import { describe, it, expect } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { DisplayMessage, DisplayContent } from '@qlan-ro/mainframe-types';
import { convertMessage, PERMISSION_PLACEHOLDER } from '../convert-message';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Part = Exclude<ThreadMessageLike['content'], string>[number];

function assistant(content: DisplayContent[]): DisplayMessage {
  return { id: 'm1', chatId: 'c1', type: 'assistant', timestamp: '2026-06-05T00:00:00.000Z', content };
}

function parts(msg: DisplayMessage): Part[] {
  return convertMessage(msg).content as Part[];
}

function toolCalls(msg: DisplayMessage) {
  return parts(msg).filter((p): p is Part & { type: 'tool-call' } => p.type === 'tool-call');
}

// ---------------------------------------------------------------------------
// Hidden filter (preserved invariant)
// ---------------------------------------------------------------------------

describe('convertMessage — hidden tool filter', () => {
  it('omits tool_call blocks with category hidden, keeps the rest', () => {
    const msg = assistant([
      { type: 'text', text: 'hi' },
      { type: 'tool_call', id: 't1', name: 'TodoWrite', input: {}, category: 'hidden' },
      { type: 'tool_call', id: 't2', name: 'Bash', input: { command: 'ls' }, category: 'default' },
    ]);
    expect(toolCalls(msg).map((p) => p.toolName)).toEqual(['Bash']);
  });
});

// ---------------------------------------------------------------------------
// tool_group → FLAT native tool-calls (go native: no _ToolGroup wrapper)
// ---------------------------------------------------------------------------

describe('convertMessage — tool_group flattens to native tool-calls', () => {
  it('emits one flat tool-call per grouped call, not a synthetic _ToolGroup', () => {
    const msg = assistant([
      {
        type: 'tool_group',
        calls: [
          {
            type: 'tool_call',
            id: 'g1',
            name: 'Read',
            input: { file_path: '/a' },
            category: 'explore',
            result: { content: 'A', isError: false },
          },
          {
            type: 'tool_call',
            id: 'g2',
            name: 'Grep',
            input: { pattern: 'x' },
            category: 'explore',
            result: { content: 'B', isError: false },
          },
        ],
      },
    ]);
    const tcs = toolCalls(msg);
    expect(tcs.map((p) => p.toolName)).toEqual(['Read', 'Grep']);
    expect(tcs.map((p) => p.toolCallId)).toEqual(['g1', 'g2']);
    // No synthetic group wrapper part survives.
    expect(tcs.some((p) => p.toolName === '_ToolGroup')).toBe(false);
    // Each flat call carries its own result.
    expect(tcs[0]!.result).toBe('A');
    expect(tcs[1]!.result).toBe('B');
  });
});

// ---------------------------------------------------------------------------
// task_group → a Task tool-call carrying `messages` (native subagent transcript)
// ---------------------------------------------------------------------------

describe('convertMessage — task_group projects to a Task tool-call with messages', () => {
  const taskMsg = assistant([
    {
      type: 'task_group',
      agentId: 'agent-1',
      taskArgs: { subagent_type: 'explore', prompt: 'find the bug' },
      calls: [
        { type: 'text', text: 'looking…' },
        {
          type: 'tool_call',
          id: 'c1',
          name: 'Read',
          input: { file_path: '/x' },
          category: 'explore',
          result: { content: 'ok', isError: false },
        },
      ],
      result: { content: 'done', isError: false },
    },
  ]);

  it('emits a single tool-call named Task keyed on the agentId, not _TaskGroup', () => {
    const tcs = toolCalls(taskMsg);
    expect(tcs).toHaveLength(1);
    expect(tcs[0]!.toolName).toBe('Task');
    expect(tcs[0]!.toolCallId).toBe('agent-1');
    expect(tcs.some((p) => p.toolName === '_TaskGroup')).toBe(false);
  });

  it('carries the subagent transcript on part.messages', () => {
    const task = toolCalls(taskMsg)[0]! as Part & { type: 'tool-call'; messages?: ThreadMessageLike[] };
    expect(Array.isArray(task.messages)).toBe(true);
    // The prompt becomes a leading user turn; the agent work an assistant turn.
    const roles = task.messages!.map((m) => m.role);
    expect(roles).toContain('assistant');
    const assistantTurn = task.messages!.find((m) => m.role === 'assistant')!;
    const childParts = assistantTurn.content as Part[];
    expect(childParts.some((p) => p.type === 'text' && p.text === 'looking…')).toBe(true);
    expect(childParts.some((p) => p.type === 'tool-call' && p.toolName === 'Read')).toBe(true);
  });

  it('exposes the task args (subagent_type/prompt) for the card header', () => {
    const task = toolCalls(taskMsg)[0]! as Part & { type: 'tool-call'; args: Record<string, unknown> };
    expect(task.args['subagent_type']).toBe('explore');
    expect(task.args['prompt']).toBe('find the bug');
  });
});

// ---------------------------------------------------------------------------
// WS14c: nested tool_group inside a subagent transcript flattens too
// ---------------------------------------------------------------------------

describe('convertMessage — WS14c nested re-encode (subagent explore burst)', () => {
  it('flattens a tool_group nested inside task_group.calls into flat tool-calls in messages', () => {
    const msg = assistant([
      {
        type: 'task_group',
        agentId: 'agent-2',
        taskArgs: { subagent_type: 'explore' },
        calls: [
          {
            type: 'tool_group',
            calls: [
              { type: 'tool_call', id: 'n1', name: 'Read', input: {}, category: 'explore' },
              { type: 'tool_call', id: 'n2', name: 'Glob', input: {}, category: 'explore' },
            ],
          },
        ],
      },
    ]);
    const task = toolCalls(msg)[0]! as Part & { type: 'tool-call'; messages?: ThreadMessageLike[] };
    const assistantTurn = task.messages!.find((m) => m.role === 'assistant')!;
    const nested = (assistantTurn.content as Part[]).filter(
      (p): p is Part & { type: 'tool-call' } => p.type === 'tool-call',
    );
    expect(nested.map((p) => p.toolName)).toEqual(['Read', 'Glob']);
    expect(nested.some((p) => p.toolName === '_ToolGroup')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// task_progress → kept as one _TaskProgress card part
// ---------------------------------------------------------------------------

describe('convertMessage — task_progress', () => {
  it('emits a single _TaskProgress tool-call carrying the items', () => {
    const msg = assistant([
      {
        type: 'task_progress',
        items: [
          {
            id: 'p1',
            name: 'TaskCreate',
            input: { subject: 'do x' },
            category: 'progress',
            result: { content: 'Task #1', isError: false },
          },
        ],
      },
    ]);
    const tcs = toolCalls(msg);
    expect(tcs).toHaveLength(1);
    expect(tcs[0]!.toolName).toBe('_TaskProgress');
    const args = tcs[0]!.args as { items: Array<{ toolName: string }> };
    expect(args.items).toHaveLength(1);
    expect(args.items[0]!.toolName).toBe('TaskCreate');
  });
});

// ---------------------------------------------------------------------------
// Image parts go native (stop the self-imposed skip)
// ---------------------------------------------------------------------------

describe('convertMessage — image parts', () => {
  it('emits a native image part with a data URL for assistant images', () => {
    const msg = assistant([{ type: 'image', mediaType: 'image/png', data: 'AAAA' }]);
    const imageParts = parts(msg).filter((p): p is Part & { type: 'image'; image: string } => p.type === 'image');
    expect(imageParts).toHaveLength(1);
    expect(imageParts[0]!.image).toBe('data:image/png;base64,AAAA');
  });
});

// ---------------------------------------------------------------------------
// Preserved invariants: permission sentinel, dedup, error routing, fallback
// ---------------------------------------------------------------------------

describe('convertMessage — preserved invariants', () => {
  it('renders the \\0 permission sentinel for permission_request blocks', () => {
    const msg = assistant([{ type: 'permission_request', request: { type: 'tool', toolName: 'Bash' } as never }]);
    expect(parts(msg).some((p) => p.type === 'text' && p.text === PERMISSION_PLACEHOLDER.text)).toBe(true);
  });

  it('deduplicates duplicate toolCallIds so assistant-ui never sees a duplicate key', () => {
    const msg = assistant([
      { type: 'tool_call', id: 'dup', name: 'Read', input: {}, category: 'default' },
      { type: 'tool_call', id: 'dup', name: 'Read', input: {}, category: 'default' },
    ]);
    const ids = toolCalls(msg).map((p) => p.toolCallId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('routes error blocks to a text part (keep text routing)', () => {
    const msg = assistant([{ type: 'error', message: 'boom' }]);
    expect(parts(msg).some((p) => p.type === 'text' && p.text === 'boom')).toBe(true);
  });

  it('never returns an empty content array', () => {
    const msg = assistant([]);
    expect(parts(msg).length).toBeGreaterThanOrEqual(1);
  });

  it('maps thinking blocks to reasoning parts', () => {
    const msg = assistant([{ type: 'thinking', thinking: 'hmm' }]);
    expect(parts(msg).some((p) => p.type === 'reasoning' && (p as { text: string }).text === 'hmm')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BEHAVIOR 1 — partGroups membership in metadata (daemon-authoritative grouping)
// ---------------------------------------------------------------------------

describe('convertMessage — partGroups: tool_group members share one groupId', () => {
  it('two explore calls in a tool_group map to the same groupId in metadata.partGroups', () => {
    const msg = assistant([
      {
        type: 'tool_group',
        calls: [
          { type: 'tool_call', id: 'ex1', name: 'Read', input: {}, category: 'explore' as const },
          { type: 'tool_call', id: 'ex2', name: 'Grep', input: {}, category: 'explore' as const },
        ],
      },
    ]);
    const partGroups = (
      convertMessage(msg) as { metadata?: { custom?: { mainframe?: { partGroups?: Record<string, string> } } } }
    ).metadata?.custom?.mainframe?.partGroups;

    // Both ids are present and point to the same groupId (the first member's id).
    expect(partGroups?.['ex1']).toBe('ex1');
    expect(partGroups?.['ex2']).toBe('ex1');
  });

  it('a standalone tool_call (not in a tool_group) has no entry in partGroups', () => {
    const msg = assistant([
      { type: 'tool_call', id: 'standalone', name: 'Bash', input: { command: 'ls' }, category: 'default' as const },
    ]);
    const partGroups = (
      convertMessage(msg) as { metadata?: { custom?: { mainframe?: { partGroups?: Record<string, string> } } } }
    ).metadata?.custom?.mainframe?.partGroups;

    expect(partGroups?.['standalone']).toBeUndefined();
  });

  it('a message with no groups has no partGroups metadata', () => {
    const msg = assistant([
      { type: 'text', text: 'hello' },
      { type: 'tool_call', id: 'solo', name: 'Write', input: {}, category: 'default' as const },
    ]);
    const meta = convertMessage(msg).metadata;

    // No groups → metadata should be absent entirely.
    expect(meta).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// BEHAVIOR 1 — partGroups in subagent (task_group) nested assistant turn
// ---------------------------------------------------------------------------

describe('convertMessage — partGroups: nested tool_group inside task_group', () => {
  it('nested assistant turn carries its own partGroups for a tool_group inside the subagent', () => {
    const msg = assistant([
      {
        type: 'task_group',
        agentId: 'sub-1',
        taskArgs: { subagent_type: 'explore', prompt: 'search' },
        calls: [
          {
            type: 'tool_group',
            calls: [
              { type: 'tool_call', id: 'n1', name: 'Read', input: {}, category: 'explore' as const },
              { type: 'tool_call', id: 'n2', name: 'Glob', input: {}, category: 'explore' as const },
            ],
          },
        ],
        result: { content: 'done', isError: false },
      },
    ]);

    const task = toolCalls(msg)[0]! as Part & {
      type: 'tool-call';
      messages?: Array<{ role: string; metadata?: unknown; content: unknown }>;
    };
    const assistantTurn = task.messages!.find((m) => m.role === 'assistant')!;

    type TurnMeta = { custom?: { mainframe?: { partGroups?: Record<string, string> } } };
    const partGroups = (assistantTurn.metadata as TurnMeta)?.custom?.mainframe?.partGroups;

    // n1 is the groupId (first member); n2 maps to the same groupId.
    expect(partGroups?.['n1']).toBe('n1');
    expect(partGroups?.['n2']).toBe('n1');
  });

  it('a task_group with no nested tool_group produces no partGroups on the subagent assistant turn', () => {
    const msg = assistant([
      {
        type: 'task_group',
        agentId: 'sub-2',
        taskArgs: { subagent_type: 'explore', prompt: 'look' },
        calls: [{ type: 'tool_call', id: 'lone', name: 'Read', input: {}, category: 'explore' as const }],
        result: { content: 'ok', isError: false },
      },
    ]);

    const task = toolCalls(msg)[0]! as Part & {
      type: 'tool-call';
      messages?: Array<{ role: string; metadata?: unknown }>;
    };
    const assistantTurn = task.messages!.find((m) => m.role === 'assistant')!;

    // assistant-ui hydrates a default metadata envelope; the important invariant
    // is that custom.mainframe is absent (no groups were recorded).
    type TurnMeta = { custom?: { mainframe?: unknown } };
    const mainframeMeta = (assistantTurn.metadata as TurnMeta)?.custom?.mainframe;
    expect(mainframeMeta).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// BEHAVIOR 2 — groupSummaries: derived header summary alongside partGroups
// ---------------------------------------------------------------------------

describe('convertMessage — groupSummaries: tool_group records derived summary', () => {
  type MainframeMeta = {
    partGroups?: Record<string, string>;
    groupSummaries?: Record<string, string>;
  };

  it('records "Read 1 file" summary for a single-Read tool_group', () => {
    const msg = assistant([
      {
        type: 'tool_group',
        calls: [
          { type: 'tool_call', id: 'r1', name: 'Read', input: { file_path: '/a.ts' }, category: 'explore' as const },
        ],
      },
    ]);
    const mainframe = (convertMessage(msg) as { metadata?: { custom?: { mainframe?: MainframeMeta } } }).metadata
      ?.custom?.mainframe;

    // groupId = first member id = 'r1'
    expect(mainframe?.groupSummaries?.['r1']).toBe('Read 1 file');
  });

  it('records "Read 2 files · Searched 1 pattern" for a mixed Read+Grep group', () => {
    const msg = assistant([
      {
        type: 'tool_group',
        calls: [
          { type: 'tool_call', id: 'g1', name: 'Read', input: {}, category: 'explore' as const },
          { type: 'tool_call', id: 'g2', name: 'Read', input: {}, category: 'explore' as const },
          { type: 'tool_call', id: 'g3', name: 'Grep', input: {}, category: 'explore' as const },
        ],
      },
    ]);
    const mainframe = (convertMessage(msg) as { metadata?: { custom?: { mainframe?: MainframeMeta } } }).metadata
      ?.custom?.mainframe;

    // groupId = 'g1' (first member)
    expect(mainframe?.groupSummaries?.['g1']).toBe('Read 2 files · Searched 1 pattern');
  });

  it('groupSummaries key matches the groupId recorded in partGroups', () => {
    const msg = assistant([
      {
        type: 'tool_group',
        calls: [
          { type: 'tool_call', id: 'x1', name: 'Glob', input: {}, category: 'explore' as const },
          { type: 'tool_call', id: 'x2', name: 'LS', input: {}, category: 'explore' as const },
        ],
      },
    ]);
    const mainframe = (convertMessage(msg) as { metadata?: { custom?: { mainframe?: MainframeMeta } } }).metadata
      ?.custom?.mainframe;

    const groupId = mainframe?.partGroups?.['x1'];
    // The summary must be indexed under the same groupId that partGroups points to.
    expect(groupId).toBeDefined();
    expect(mainframe?.groupSummaries?.[groupId!]).toBe('Globbed 1 pattern · Listed 1 directory');
  });

  it('a message with no tool_group has no groupSummaries in metadata', () => {
    const msg = assistant([
      { type: 'tool_call', id: 'solo', name: 'Bash', input: { command: 'ls' }, category: 'default' as const },
    ]);
    const mainframe = (convertMessage(msg) as { metadata?: { custom?: { mainframe?: MainframeMeta } } }).metadata
      ?.custom?.mainframe;

    expect(mainframe).toBeUndefined();
  });
});
