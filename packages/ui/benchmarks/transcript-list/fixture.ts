/**
 * Synthetic transcript shaped like a real Mainframe chat: turns of a user prompt
 * and several assistant messages holding tool calls (100-line Read outputs, Bash,
 * Grep, Edit, nested Task agents), reasoning text, and an answer with a heading,
 * prose, a 30-line code block, an 8-row table and, in some turns, a remote image
 * that loads late. No real transcript content.
 */
import type { ThreadMessage, ToolCallMessagePart } from '@assistant-ui/react';

type Args = ToolCallMessagePart['args'];

const BASE = Date.UTC(2026, 10, 20, 9, 0);
const done = { providerMetadata: { mainframe: { acpStatus: 'completed' } } } as const;

export interface Turn {
  index: number;
  messages: ThreadMessage[];
}

const words = 'The module keeps its state in one place and the caller reads it through a narrow interface.';
const prose = (n: number) => Array.from({ length: n }, () => words).join(' ');

function tool(id: string, toolName: string, args: Args, result: string): ToolCallMessagePart {
  return { type: 'tool-call', toolCallId: id, toolName, args, argsText: JSON.stringify(args), result, ...done };
}

function readTool(id: string, file: string) {
  const body = Array.from({ length: 100 }, (_, i) => `export const value${i} = compute(${i}, "${file}");`).join('\n');
  return tool(id, 'Read', { file_path: `/workspace/src/${file}.ts` }, body);
}

function codeBlock(index: number, extra = 0) {
  const lines = Array.from(
    { length: 30 + extra },
    (_, i) => `  const row${i} = { index: ${i}, label: "turn ${index}", ok: ${i % 2 === 0} };`,
  );
  return '```typescript\nexport function build' + index + '() {\n' + lines.join('\n') + '\n}\n```';
}

function table() {
  const rows = Array.from(
    { length: 8 },
    (_, i) => `| ${i} | ${'Evidence wraps across the column. '.repeat(3)} | Pass |`,
  );
  return `| Case | Evidence | Result |\n| --- | --- | --- |\n${rows.join('\n')}`;
}

export interface AnswerOptions {
  image?: string;
  codeExtra?: number;
}

export function answerText(index: number, options: AnswerOptions = {}) {
  const image = options.image ? `\n\n![Diagram ${index}](${options.image})\n` : '';
  return `## Result for module ${index}\n\n${prose(4)}\n\n${codeBlock(index, options.codeExtra)}\n\n${table()}${image}\n\n${prose(2)}`;
}

function assistant(id: string, index: number, content: ThreadMessage['content'], running = false): ThreadMessage {
  return {
    id,
    role: 'assistant',
    createdAt: new Date(BASE + index * 120_000 + 30_000),
    content,
    status: running ? { type: 'running' } : { type: 'complete', reason: 'stop' },
    metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} },
  } as ThreadMessage;
}

export function userMessage(id: string, index: number, text: string): ThreadMessage {
  return {
    id,
    role: 'user',
    createdAt: new Date(BASE + index * 120_000),
    content: [{ type: 'text', text }],
    attachments: [],
    metadata: { custom: {} },
  } as unknown as ThreadMessage;
}

function nestedAgent(id: string, index: number): ToolCallMessagePart {
  return {
    ...tool(id, 'Task', { subagent_type: 'explorer', description: `Inspect package ${index}` }, 'Agent finished.'),
    messages: [
      assistant(`${id}-child`, index, [
        { type: 'text', text: prose(3) },
        readTool(`${id}-child-read`, `nested-${index}`),
      ]),
    ],
  } as ToolCallMessagePart;
}

export interface TurnOptions {
  image?: (index: number) => string | undefined;
  codeExtra?: number;
}

/** One finished turn: a user prompt and five assistant messages, about six list items. */
export function buildTurn(index: number, options: TurnOptions = {}): Turn {
  const t = `t${index}`;
  const messages: ThreadMessage[] = [
    userMessage(`${t}-u`, index, `Can you check module ${index} and fix what fails? ${prose(index % 3)}`),
    assistant(`${t}-a1`, index, [
      { type: 'text', text: `I'll read the module first. ${prose(1)}` },
      readTool(`${t}-read`, `module-${index}`),
    ]),
    assistant(`${t}-a2`, index, [
      tool(`${t}-bash`, 'Bash', { command: `pnpm test module-${index}` }, `PASS module-${index}\n`.repeat(20)),
      tool(`${t}-grep`, 'Grep', { pattern: `value${index}`, path: '/workspace/src' }, `src/a.ts:${index}\n`.repeat(8)),
    ]),
    assistant(`${t}-a3`, index, [
      { type: 'text', text: prose(2) },
      tool(
        `${t}-edit`,
        'Edit',
        { file_path: `/workspace/src/module-${index}.ts`, old_string: 'const a = 1;', new_string: 'const a = 2;' },
        'The file was updated.',
      ),
    ]),
  ];
  if (index % 4 === 1) messages.push(assistant(`${t}-a4`, index, [nestedAgent(`${t}-agent`, index)]));
  messages.push(
    assistant(`${t}-a5`, index, [
      { type: 'text', text: answerText(index, { image: options.image?.(index), codeExtra: options.codeExtra }) },
    ]),
  );
  return { index, messages };
}

/** Items the daemon counts toward a page: each text part and each tool call. */
export const itemCount = (message: ThreadMessage) => message.content.length;

export interface Transcript {
  /** Every message, oldest first. */
  all: ThreadMessage[];
  /** Index in `all` where the loaded window starts. */
  windowStart: number;
}

/**
 * `turns` turns in total; the window holds the newest `windowTurns` and starts
 * inside a turn (after its first two assistant messages), the way a page of
 * "40 groups or 80 items" can end mid-group.
 */
export function buildTranscript(turns: number, windowTurns: number, options: TurnOptions = {}): Transcript {
  const all = Array.from({ length: turns }, (_, i) => buildTurn(i, options).messages).flat();
  const first = turns - windowTurns;
  const cut = all.findIndex((message) => message.id === `t${first}-a3`);
  return { all, windowStart: Math.max(0, cut) };
}

/** The page before `start`: whole messages back to at least 80 items. */
export function previousPage(all: ThreadMessage[], start: number, items = 80): number {
  let count = 0;
  let at = start;
  while (at > 0 && count < items) {
    at--;
    count += itemCount(all[at]!);
  }
  return at;
}

/** A turn with a lot of work (about 20 steps) and a long answer, for the fold-at-turn-end cases. */
export function buildLongTurn(index: number): ThreadMessage[] {
  const t = `long${index}`;
  const steps = Array.from({ length: 10 }, (_, i) =>
    assistant(`${t}-s${i}`, index, [
      { type: 'text', text: `Step ${i}: ${prose(2)}` },
      tool(`${t}-bash${i}`, 'Bash', { command: `pnpm test part-${i}` }, `PASS part-${i}\n`.repeat(6)),
    ]),
  );
  const answer = assistant(`${t}-answer`, index, [
    { type: 'text', text: `${answerText(index)}\n\n${prose(10)}\n\n${codeBlock(index + 1)}\n\n${prose(10)}` },
  ]);
  return [userMessage(`${t}-u`, index, `Run the whole suite for module ${index}.`), ...steps, answer];
}
