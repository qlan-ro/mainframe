import { describe, expect, it } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { AccumulatedItem } from '../acp-item-accumulator';
import { convertAcpItems } from '../convert-acp-item';
import type { ContentPart } from '../content';
import type { MainframeMessageMeta } from '../message-meta';
import { SANDBOX_CAPTURE_SENTINEL } from '../../markers/message-markers';

const createdAt = new Date('2026-08-28T00:00:00.000Z');
const stampFor = () => createdAt;

function textBlock(text: string) {
  return { type: 'text' as const, text };
}

function imageBlock(mimeType: string, data: string) {
  return { type: 'image' as const, mimeType, data };
}

function itemMeta(fields: Record<string, unknown>) {
  return { '_mainframe.dev': fields };
}

function mainframeMeta(container: ThreadMessageLike): MainframeMessageMeta | undefined {
  return (container.metadata?.custom as { mainframe?: MainframeMessageMeta } | undefined)?.mainframe;
}

/** Single-item container: no containerId in meta, so the item's own id is the container id. */
function toolResultOf(item: AccumulatedItem): unknown {
  const container = convertAcpItems([item], stampFor)[0]!;
  return (container.content[0] as { result?: unknown }).result;
}

describe('convertAcpItems — reaggregation', () => {
  it('folds a message + two tool-calls + a thought sharing containerId into one assistant message, parts in item order', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'm1',
        role: 'agent',
        content: [textBlock('Hello')],
        meta: itemMeta({ containerId: 'c1', timestamp: '2026-08-28T00:00:05.000Z' }),
      },
      {
        kind: 'tool-call',
        id: 't1',
        title: 'Read',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'A' } }],
        rawInput: { file_path: '/a' },
        meta: itemMeta({ containerId: 'c1' }),
      },
      {
        kind: 'tool-call',
        id: 't2',
        title: 'Write',
        status: 'completed',
        content: [],
        rawInput: {},
        meta: itemMeta({ containerId: 'c1' }),
      },
      {
        kind: 'thought',
        id: 'th1',
        content: [textBlock('thinking')],
        meta: itemMeta({ containerId: 'c1' }),
      },
    ];

    const container = convertAcpItems(items, () => new Date('2099-01-01T00:00:00.000Z'))[0]!;

    expect(container).toEqual({
      role: 'assistant',
      id: 'c1',
      createdAt: new Date('2026-08-28T00:00:05.000Z'),
      content: [
        { type: 'text', text: 'Hello' },
        {
          type: 'tool-call',
          toolCallId: 't1',
          toolName: 'Read',
          args: { file_path: '/a' },
          result: 'A',
          isError: undefined,
        },
        {
          type: 'tool-call',
          toolCallId: 't2',
          toolName: 'Write',
          args: {},
          result: undefined,
          isError: undefined,
        },
        { type: 'reasoning', text: 'thinking' },
      ],
    });
  });

  it('items with different containerIds produce separate messages in first-seen order', () => {
    const items: AccumulatedItem[] = [
      { kind: 'message', id: 'm1', role: 'agent', content: [textBlock('first')], meta: itemMeta({ containerId: 'c1' }) },
      { kind: 'message', id: 'm2', role: 'agent', content: [textBlock('second')], meta: itemMeta({ containerId: 'c2' }) },
      {
        kind: 'tool-call',
        id: 't1',
        title: 'Bash',
        status: 'completed',
        content: [],
        meta: itemMeta({ containerId: 'c1' }),
      },
      {
        kind: 'tool-call',
        id: 't2',
        title: 'Bash',
        status: 'completed',
        content: [],
        meta: itemMeta({ containerId: 'c2' }),
      },
    ];

    const converted = convertAcpItems(items, stampFor);
    expect(converted.map((m) => m.id)).toEqual(['c1', 'c2']);
    expect(converted[0]!.content).toEqual([
      { type: 'text', text: 'first' },
      { type: 'tool-call', toolCallId: 't1', toolName: 'Bash', args: {}, result: undefined, isError: undefined },
    ]);
    expect(converted[1]!.content).toEqual([
      { type: 'text', text: 'second' },
      { type: 'tool-call', toolCallId: 't2', toolName: 'Bash', args: {}, result: undefined, isError: undefined },
    ]);
  });
});

describe('convertAcpItems — tool-group echo', () => {
  it('echoes groupId membership into partGroups and derives a groupSummaries entry', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'tool-call',
        id: 't1',
        title: 'Read',
        status: 'completed',
        content: [],
        rawInput: {},
        meta: itemMeta({ containerId: 'c1', groupId: 'g1' }),
      },
      {
        kind: 'tool-call',
        id: 't2',
        title: 'Read',
        status: 'completed',
        content: [],
        rawInput: {},
        meta: itemMeta({ containerId: 'c1', groupId: 'g1' }),
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.metadata).toEqual({
      custom: {
        mainframe: {
          partGroups: { t1: 'g1', t2: 'g1' },
          groupSummaries: { g1: 'Read 2 files' },
        },
      },
    });
  });
});

describe('convertAcpItems — assistant cost/timing', () => {
  it('reads cost_usd and turnDurationMs off messageMeta into metadata.custom.mainframe.cost and metadata.timing', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'a1',
        role: 'agent',
        content: [textBlock('done')],
        meta: itemMeta({ containerId: 'c3', messageMeta: { cost_usd: 0.42, turnDurationMs: 5120 } }),
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.metadata).toEqual({
      timing: { streamStartTime: 0, totalStreamTime: 5120, totalChunks: 0, toolCallCount: 0 },
      custom: { mainframe: { cost: 0.42 } },
    });
  });
});

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

describe('convertAcpItems — user container: sandbox captures', () => {
  it('routes capture images into native attachments, sets mainframe.captures, keeps the rest text', () => {
    const text =
      SANDBOX_CAPTURE_SENTINEL + '\n> **Preview captures**\n> - `element1` — selector `nav > .x`\n\nfix the spacing';
    const items: AccumulatedItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: [textBlock(text), imageBlock('image/png', 'AAAA')] },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.role).toBe('user');
    expect(container.content).toEqual([{ type: 'text', text: 'fix the spacing' }]);
    expect(container.attachments).toEqual([
      {
        id: 'element1.png',
        type: 'image',
        name: 'element1.png',
        contentType: 'image/png',
        content: [{ type: 'image', image: 'data:image/png;base64,AAAA' }],
        status: { type: 'complete' },
      },
    ]);
    expect(mainframeMeta(container)?.captures).toEqual([
      { label: 'element1', imageName: 'element1.png', selector: 'nav > .x' },
    ]);
  });

  it('keeps an image block as a plain image content part when there is no capture sentinel', () => {
    const items: AccumulatedItem[] = [
      { kind: 'message', id: 'u2', role: 'user', content: [textBlock('hi'), imageBlock('image/png', 'AAAA')] },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.content).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image', image: 'data:image/png;base64,AAAA' },
    ]);
    expect(container.attachments).toBeUndefined();
    expect(container.metadata).toBeUndefined();
  });
});

describe('convertAcpItems — user container: file attachments', () => {
  it('merges attachment previews (kind file) with attachedFiles, deduped by name, contentType from preview mediaType', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'u3',
        role: 'user',
        content: [textBlock('look')],
        meta: itemMeta({
          messageMeta: {
            attachments: [
              { name: 'doc.pdf', kind: 'file', sizeBytes: 9000, mediaType: 'application/pdf' },
              { name: 'shot.png', kind: 'image' },
            ],
            attachedFiles: [{ name: 'doc.pdf' }, { name: 'extra.log' }],
          },
        }),
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.attachments).toEqual([
      {
        id: 'doc.pdf',
        type: 'file',
        name: 'doc.pdf',
        contentType: 'application/pdf',
        content: [],
        status: { type: 'complete' },
      },
      {
        id: 'extra.log',
        type: 'file',
        name: 'extra.log',
        contentType: 'application/octet-stream',
        content: [],
        status: { type: 'complete' },
      },
    ]);
    expect(mainframeMeta(container)?.attachmentPreviews).toEqual([
      { name: 'doc.pdf', kind: 'file', sizeBytes: 9000, mediaType: 'application/pdf' },
      { name: 'shot.png', kind: 'image' },
    ]);
  });
});

describe('convertAcpItems — user container: coerceUserMeta', () => {
  it('coerces command/queued/cleanText into mainframe meta and drops malformed fields', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'u4',
        role: 'user',
        content: [textBlock('go')],
        meta: itemMeta({
          messageMeta: {
            queued: true,
            cleanText: 'go',
            command: { name: 'plan', userText: 'go' },
            error: 123,
            pending: 'yes',
          },
        }),
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(mainframeMeta(container)).toEqual({
      queued: true,
      cleanText: 'go',
      command: { name: 'plan', userText: 'go' },
    });
  });
});

describe('convertAcpItems — user container: review comment', () => {
  it('parses a review-comment text into mainframe.reviewComment and drops the raw text part', () => {
    const text = 'Diff of `app/globals.css`\n\nAt line 43:\n```\n--mf-app-bg: #f4f4f2;\n```\ntoo bright';
    const items: AccumulatedItem[] = [{ kind: 'message', id: 'u5', role: 'user', content: [textBlock(text)] }];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(mainframeMeta(container)?.reviewComment).toEqual({
      file: 'app/globals.css',
      comments: [{ start: 43, code: '--mf-app-bg: #f4f4f2;', body: 'too bright' }],
    });
    expect(container.content).toEqual([{ type: 'text', text: '' }]);
  });
});

describe('convertAcpItems — system container', () => {
  it('carries skillLoaded/isCompacted into role system + metadata.custom.mainframe', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 's1',
        role: 'agent',
        content: [textBlock('note')],
        meta: itemMeta({
          kind: 'system',
          isCompacted: true,
          skillLoaded: { skillName: 'x', path: '/y', content: 'z' },
        }),
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.role).toBe('system');
    expect(container.content).toEqual([{ type: 'text', text: 'note' }]);
    expect(mainframeMeta(container)).toEqual({
      isCompacted: true,
      skillLoaded: { skillName: 'x', path: '/y', content: 'z' },
    });
  });

  it('ensureNonEmpty gives one empty text part when there are no text blocks', () => {
    const items: AccumulatedItem[] = [
      { kind: 'message', id: 's2', role: 'agent', content: [], meta: itemMeta({ kind: 'system' }) },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.role).toBe('system');
    expect(container.content).toEqual([{ type: 'text', text: '' }]);
    expect(container.metadata).toBeUndefined();
  });
});

describe('convertAcpItems — error container', () => {
  it('sets role assistant, the errorText as content, and metadata.custom.mainframe.errorText', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'e1',
        role: 'agent',
        content: [],
        meta: itemMeta({ kind: 'error', errorText: 'CLI died' }),
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.role).toBe('assistant');
    expect(container.content).toEqual([{ type: 'text', text: 'CLI died' }]);
    expect(mainframeMeta(container)).toEqual({ errorText: 'CLI died' });
  });
});

describe('convertAcpItems — ensureNonEmpty (assistant)', () => {
  it('an empty agent message item still renders one empty text part', () => {
    const items: AccumulatedItem[] = [{ kind: 'message', id: 'a1', role: 'agent', content: [] }];
    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.content).toEqual([{ type: 'text', text: '' }]);
  });
});

describe('convertAcpItems — stability', () => {
  it('converting the same container twice yields deeply equal results', () => {
    const items: AccumulatedItem[] = [
      { kind: 'message', id: 'm1', role: 'agent', content: [textBlock('hi')], meta: itemMeta({ containerId: 'c1' }) },
      {
        kind: 'tool-call',
        id: 't1',
        title: 'Bash',
        status: 'completed',
        content: [],
        meta: itemMeta({ containerId: 'c1' }),
      },
    ];

    const first = convertAcpItems(items, stampFor);
    const second = convertAcpItems(items, stampFor);
    expect(second).toEqual(first);
  });

  it('a container whose meta lacks containerId falls back to grouping by item id', () => {
    const items: AccumulatedItem[] = [
      { kind: 'tool-call', id: 'solo-1', title: 'Bash', status: 'completed', content: [] },
      { kind: 'tool-call', id: 'solo-2', title: 'Bash', status: 'completed', content: [] },
    ];

    const converted = convertAcpItems(items, stampFor);
    expect(converted.map((m) => m.id)).toEqual(['solo-1', 'solo-2']);
  });
});
