/**
 * Synthetic transcript frames for the transcript-pipeline benchmarks and the
 * render-isolation regression test. Shapes follow the ACP facade wire grammar
 * (`@qlan-ro/mainframe-types` `SessionUpdate`) in strict-creation mode: every
 * item's first frame carries the `created` marker and a `containerId`.
 */
import type { SessionUpdate } from '@qlan-ro/mainframe-types';

const NS = '_mainframe.dev';

const LOREM =
  'The quick brown fox jumps over the lazy dog while the daemon streams another chunk of markdown into the transcript. ';

function paragraph(words: number): string {
  let out = '';
  while (out.length < words * 6) out += LOREM;
  return out.slice(0, words * 6);
}

function markdownAnswer(turn: number): string {
  return [
    `## Turn ${turn}: what changed`,
    '',
    `${paragraph(60)} See \`packages/ui/src/features/chat/thread/ChatThread.tsx:42\` and [the docs](https://example.com/${turn}).`,
    '',
    '- First point with **bold** and _italic_ text',
    '- Second point mentioning `useExternalStoreRuntime`',
    '- Third point',
    '',
    '```ts',
    'export function convert(items: readonly Item[]): Message[] {',
    '  const out: Message[] = [];',
    '  for (const item of items) {',
    `    if (item.kind === 'message') out.push(toMessage(item, ${turn}));`,
    "    else if (item.kind === 'tool-call') out.push(toTool(item));",
    '  }',
    '  return out;',
    '}',
    '```',
    '',
    '| Column | Value |',
    '| --- | --- |',
    `| turn | ${turn} |`,
    '| status | done |',
    '',
    paragraph(40),
  ].join('\n');
}

function fileText(lines: number, seed: number): string {
  return Array.from({ length: lines }, (_, i) => `const line${i} = ${seed + i}; // ${LOREM.slice(0, 40)}`).join('\n');
}

function meta(fields: Record<string, unknown>): Record<string, unknown> {
  return { [NS]: { created: true, ...fields } };
}

function stamp(turn: number, step: number): string {
  return new Date(Date.UTC(2026, 9, 1, 12, 0, turn * 10 + step)).toISOString();
}

/** One complete turn: a user message, a thought, three tool calls (two in an explore group), and a markdown answer. */
export function turnFrames(turn: number): SessionUpdate[] {
  const container = `a${turn}`;
  const startedAt = Date.UTC(2026, 9, 1, 12, 0, turn * 10);
  return [
    {
      sessionUpdate: 'user_message',
      messageId: `u${turn}`,
      content: [{ type: 'text', text: `Question ${turn}: ${paragraph(30)}` }],
      _meta: meta({ containerId: `u${turn}`, timestamp: stamp(turn, 0), messageMeta: {} }),
    },
    {
      sessionUpdate: 'agent_thought',
      messageId: `th${turn}`,
      content: [{ type: 'text', text: paragraph(50) }],
      _meta: meta({ containerId: container, timestamp: stamp(turn, 1) }),
    },
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: `tc${turn}-read`,
      title: 'Read',
      kind: 'read',
      status: 'completed',
      rawInput: { file_path: `/repo/src/module${turn}.ts` },
      content: [{ type: 'content', content: { type: 'text', text: fileText(40, turn) } }],
      _meta: meta({
        containerId: container,
        groupId: `g${turn}`,
        toolCallTiming: { startedAt, completedAt: startedAt + 120 },
      }),
    },
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: `tc${turn}-grep`,
      title: 'Grep',
      kind: 'search',
      status: 'completed',
      rawInput: { pattern: `symbol${turn}`, path: '/repo/src' },
      content: [{ type: 'content', content: { type: 'text', text: fileText(12, turn + 100) } }],
      _meta: meta({
        containerId: container,
        groupId: `g${turn}`,
        toolCallTiming: { startedAt: startedAt + 130, completedAt: startedAt + 300 },
      }),
    },
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: `tc${turn}-edit`,
      title: 'Edit',
      kind: 'edit',
      status: 'completed',
      rawInput: { file_path: `/repo/src/module${turn}.ts`, old_string: 'const a = 1;', new_string: 'const a = 2;' },
      content: [
        {
          type: 'diff',
          changes: [{ operation: 'modify', path: `/repo/src/module${turn}.ts` }],
          _meta: {
            [NS]: {
              structuredPatch: [
                {
                  oldStart: 1,
                  oldLines: 5,
                  newStart: 1,
                  newLines: 5,
                  lines: ['-const a = 1;', '+const a = 2;', ' const b = 2;', ' const c = 3;', ' const d = 4;'],
                },
              ],
              originalFile: fileText(30, turn),
              modifiedFile: fileText(30, turn + 1),
            },
          },
        },
      ],
      _meta: meta({
        containerId: container,
        toolCallTiming: { startedAt: startedAt + 400, completedAt: startedAt + 450 },
      }),
    },
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: `tc${turn}-bash`,
      title: 'Bash',
      kind: 'execute',
      status: 'completed',
      rawInput: { command: `pnpm test module${turn}`, description: 'Run the module tests' },
      content: [{ type: 'content', content: { type: 'text', text: fileText(20, turn + 200) } }],
      _meta: meta({
        containerId: container,
        toolCallTiming: { startedAt: startedAt + 500, completedAt: startedAt + 2500 },
      }),
    },
    {
      sessionUpdate: 'agent_message',
      messageId: `am${turn}`,
      content: [{ type: 'text', text: markdownAnswer(turn) }],
      _meta: meta({
        containerId: container,
        timestamp: stamp(turn, 2),
        messageMeta: { cost_usd: 0.0123, turnDurationMs: 12_345 },
      }),
    },
  ];
}

/** `turns` complete turns, in order. */
export function transcriptFrames(turns: number): SessionUpdate[] {
  const frames: SessionUpdate[] = [];
  for (let turn = 1; turn <= turns; turn++) frames.push(...turnFrames(turn));
  return frames;
}

/** The creation frame of a live, streaming answer that follows `turns` completed turns. */
export function streamingTailCreate(turns: number): SessionUpdate {
  const turn = turns + 1;
  return {
    sessionUpdate: 'agent_message',
    messageId: `am${turn}`,
    content: [{ type: 'text', text: 'Starting ' }],
    _meta: meta({ containerId: `a${turn}`, timestamp: stamp(turn, 0), streaming: true }),
  };
}

/** One streamed text chunk appended to that live answer. */
export function streamingTailChunk(turns: number, index: number): SessionUpdate {
  return {
    sessionUpdate: 'agent_message_chunk',
    messageId: `am${turns + 1}`,
    content: { type: 'text', text: `chunk ${index} ${LOREM.slice(0, 48)}` },
  };
}
