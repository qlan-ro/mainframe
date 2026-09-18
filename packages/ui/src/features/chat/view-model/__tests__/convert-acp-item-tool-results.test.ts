/**
 * Tool result shapes + subagent nesting for `convertAcpItems` — split out of
 * convert-acp-item.test.ts (todo #350, plan task 37, R2.13) to keep that
 * file under the 300-line cap.
 */
import { describe, expect, it } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { AccumulatedItem } from '../acp-item-accumulator';
import { convertAcpItems } from '../convert-acp-item';
import type { ContentPart } from '../content';

const createdAt = new Date('2026-08-28T00:00:00.000Z');
const stampFor = () => createdAt;

function textBlock(text: string) {
  return { type: 'text' as const, text };
}

function itemMeta(fields: Record<string, unknown>) {
  return { '_mainframe.dev': fields };
}

/** Single-item container: no containerId in meta, so the item's own id is the container id. */
function toolResultOf(item: AccumulatedItem): unknown {
  const container = convertAcpItems([item], stampFor)[0]!;
  return (container.content[0] as { result?: unknown }).result;
}

describe('convertAcpItems — tool result shapes', () => {
  it('a plain text content block yields the joined text as the result', () => {
    const item: AccumulatedItem = {
      kind: 'tool-call',
      id: 't5',
      title: 'Bash',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'short output' } }],
    };
    expect(toolResultOf(item)).toBe('short output');
  });

  it('sets isError on a failed tool call', () => {
    const item: AccumulatedItem = { kind: 'tool-call', id: 't1', status: 'failed', content: [] };
    const container = convertAcpItems([item], stampFor)[0]!;
    const part = container.content[0] as { isError?: boolean; result?: unknown };
    expect(part.isError).toBe(true);
    expect(part.result).toBeUndefined();
  });

  it('a truncation marker on a text block yields the {content,truncated,fullBytes} result shape', () => {
    const item: AccumulatedItem = {
      kind: 'tool-call',
      id: 't4',
      title: 'Bash',
      status: 'completed',
      content: [
        {
          type: 'content',
          content: {
            type: 'text',
            text: 'head\n…[truncated · 142 KB — expand]…\ntail',
            _meta: { '_mainframe.dev': { truncated: true, fullBytes: 145728 } },
          },
        },
      ],
    };
    expect(toolResultOf(item)).toEqual({
      content: 'head\n…[truncated · 142 KB — expand]…\ntail',
      truncated: true,
      fullBytes: 145728,
    });
  });

  it('a diff entry with the fidelity payload yields the structured-patch result shape', () => {
    const item: AccumulatedItem = {
      kind: 'tool-call',
      id: 't2',
      title: 'Edit',
      status: 'completed',
      content: [
        { type: 'content', content: { type: 'text', text: 'Applied 1 edit' } },
        {
          type: 'diff',
          changes: [{ operation: 'modify', path: '/w/src/config.json', fileType: 'text' }],
          patch: { format: 'git_patch', text: 'diff --git /w/src/config.json /w/src/config.json\n' },
          _meta: {
            '_mainframe.dev': {
              structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-false', '+true'] }],
              originalFile: 'false',
              modifiedFile: 'true',
            },
          },
        },
      ],
      rawInput: { file_path: '/w/src/config.json' },
    };
    expect(toolResultOf(item)).toEqual({
      content: 'Applied 1 edit',
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-false', '+true'] }],
      originalFile: 'false',
      modifiedFile: 'true',
    });
  });

  it('a diff entry without the fidelity payload degrades to the joined text result', () => {
    const item: AccumulatedItem = {
      kind: 'tool-call',
      id: 't3',
      title: 'Edit',
      status: 'completed',
      content: [
        { type: 'content', content: { type: 'text', text: 'OK' } },
        { type: 'diff', changes: [{ operation: 'add', path: '/w/new.ts' }] },
      ],
    };
    expect(toolResultOf(item)).toBe('OK');
  });

  it('a text block whose _meta askUserQuestion is an array yields the {content,askUserQuestion} result shape', () => {
    const item: AccumulatedItem = {
      kind: 'tool-call',
      id: 't6',
      title: 'AskUserQuestion',
      status: 'completed',
      content: [
        {
          type: 'content',
          content: {
            type: 'text',
            text: 'Which approach?',
            _meta: { '_mainframe.dev': { askUserQuestion: [{ question: 'Which approach?', answer: 'A' }] } },
          },
        },
      ],
    };
    expect(toolResultOf(item)).toEqual({
      content: 'Which approach?',
      askUserQuestion: [{ question: 'Which approach?', answer: 'A' }],
    });
  });
});

describe('convertAcpItems — subagent nesting', () => {
  const taskId = 'task-1';
  const items: AccumulatedItem[] = [
    {
      kind: 'tool-call',
      id: taskId,
      title: 'Investigate the flake',
      status: 'completed',
      content: [],
      rawInput: { description: 'Investigate', prompt: 'find the flake' },
      meta: itemMeta({ subagent: true }),
    },
    {
      kind: 'message',
      id: `${taskId}-message`,
      role: 'agent',
      content: [textBlock('still investigating')],
      meta: itemMeta({ parentToolCallId: taskId }),
    },
    {
      kind: 'tool-call',
      id: `${taskId}-tool`,
      title: 'Grep',
      status: 'completed',
      content: [],
      meta: itemMeta({ parentToolCallId: taskId }),
    },
  ];

  it('children never appear as top-level messages', () => {
    const converted = convertAcpItems(items, stampFor);
    expect(converted.map((m) => m.id)).toEqual([taskId]);
  });

  it('builds a Task tool-call part carrying a prompt user turn and an assistant transcript turn', () => {
    const container = convertAcpItems(items, stampFor)[0]!;
    const part = container.content[0] as ContentPart & {
      type: 'tool-call';
      messages: readonly ThreadMessageLike[];
    };

    expect(part.type).toBe('tool-call');
    expect(part.toolCallId).toBe(taskId);
    expect(part.toolName).toBe('Task');
    expect(part.args).toEqual({ description: 'Investigate', prompt: 'find the flake' });
    expect(part.messages).toHaveLength(2);

    const [promptMsg, transcriptMsg] = part.messages;
    expect(promptMsg!.role).toBe('user');
    expect(promptMsg!.id).toBe(`${taskId}:prompt`);
    expect(promptMsg!.content).toEqual([{ type: 'text', text: 'find the flake' }]);

    expect(transcriptMsg!.role).toBe('assistant');
    expect(transcriptMsg!.id).toBe(`${taskId}:transcript`);
    const transcriptContent = transcriptMsg!.content as ContentPart[];
    expect(transcriptContent[0]).toEqual({ type: 'text', text: 'still investigating' });
    expect(transcriptContent[1]).toMatchObject({
      type: 'tool-call',
      toolCallId: `${taskId}-tool`,
      toolName: 'Grep',
      args: {},
    });
  });
});
