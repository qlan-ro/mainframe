/** What an agent tab says (W8): the rule, against every combination of the evidence for it. */
import type { ThreadMessage } from '@assistant-ui/react';
import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { describe, expect, it } from 'vitest';
import type { ChatThreadState } from '@/features/chat/controller/chat-thread-state';
import { describeAgent, type AgentTasks } from '../agent-status';

type Status = BackgroundTask['status'];

const task = (status: Status, id = 0, summary = `Summary ${id}`) =>
  ({ id: `bg-${id}`, toolUseId: 'call-1', status, startedAt: id, summary }) as BackgroundTask;
const tasks = (...statuses: Status[]) => statuses.map((status, id) => task(status, id));

interface Text {
  text: string;
  thread: string;
  turn?: string;
  state?: string;
  phase?: string;
  parent?: string;
}

/** A nested message whose one text part is made of the given pieces, each from a Codex turn. */
function said(...pieces: Text[]): ThreadMessage {
  let end = 0;
  const sources = pieces.map(({ text, thread, turn = 't', state = 'completed', phase = 'final_answer', parent }) => ({
    sourceMessageId: `${thread}-${turn}`,
    sourceBlockIndex: 0,
    startUtf16: end,
    endUtf16: (end += text.length),
    presentation: {
      version: 1,
      provider: 'codex',
      turnId: JSON.stringify([thread, turn]),
      state,
      phase,
      finalEligible: true,
      parentToolUseId: parent ?? 'call-1',
    },
  }));
  return {
    id: 'steps',
    role: 'assistant',
    content: [{ type: 'text', text: pieces.map(({ text }) => text).join('') }],
    metadata: { custom: { mainframe: { partSources: { 0: sources } } } },
  } as unknown as ThreadMessage;
}

interface World {
  result?: string;
  error?: boolean;
  background?: boolean;
  list?: AgentTasks;
  live?: boolean;
  session?: 'idle' | 'running' | 'cancelling';
  pending?: boolean;
  acpStatus?: string;
  children?: ThreadMessage[];
}

const step = {
  id: 's',
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: 't-1', toolName: 'Bash' }],
} as unknown as ThreadMessage;

function describeWorld(w: World) {
  return describeAgent(
    {
      call: {
        messageId: 'm-1',
        part: {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'Task',
          argsText: '',
          args: w.background ? { run_in_background: true } : {},
          result: w.result,
          isError: w.error,
          messages: [step, ...(w.children ?? [])],
          providerMetadata: w.acpStatus ? { mainframe: { acpStatus: w.acpStatus } } : undefined,
        } as never,
      },
      state: {
        runState: { type: w.session ?? 'idle' },
        interactions: { permissions: w.pending ? { r: { request: { toolUseId: 't-1' } } } : {} },
      } as unknown as ChatThreadState,
      tasks: w.list ?? null,
    },
    w.live ?? true,
  );
}

/** What the header reads, or null. */
function label(w: World): string | null {
  const { status } = describeWorld(w);
  return status && (status.label ?? status.status);
}

const reports = (w: World) => describeWorld(w).reports.map(({ source, text }) => `${source}: ${text}`);

const CHILDREN = {
  none: [],
  one: [said({ text: 'One.', thread: 'a' })],
  many: [said({ text: 'One.', thread: 'a' }), said({ text: 'Two.', thread: 'b' })],
};
const LISTS: Record<string, AgentTasks> = {
  null: null,
  empty: [],
  running: tasks('running'),
  completed: tasks('completed'),
  failed: tasks('failed'),
  stopped: tasks('stopped'),
  mixed: tasks('failed', 'running', 'completed', 'running'),
  'mixed, settled': tasks('completed', 'stopped', 'failed', 'stopped'),
};
const RESULTS: Record<string, Pick<World, 'result' | 'error'>> = {
  none: {},
  text: { result: 'Two races.' },
  error: { result: 'It broke.', error: true },
};
const BOTH = [true, false];

const ROWS = Object.keys(RESULTS).flatMap((result) =>
  Object.keys(LISTS).flatMap((list) =>
    (Object.keys(CHILDREN) as (keyof typeof CHILDREN)[]).flatMap((children) =>
      BOTH.flatMap((background) =>
        BOTH.flatMap((live) =>
          BOTH.flatMap((sessionRuns) =>
            BOTH.flatMap((pending) =>
              BOTH.map((cancelled) => ({ result, list, children, background, live, sessionRuns, pending, cancelled })),
            ),
          ),
        ),
      ),
    ),
  ),
);
type Row = (typeof ROWS)[number];

const worldOf = (row: Row): World => ({
  ...RESULTS[row.result],
  list: LISTS[row.list],
  children: CHILDREN[row.children],
  background: row.background,
  live: row.live,
  session: row.sessionRuns ? 'running' : 'idle',
  pending: row.pending,
  acpStatus: row.cancelled ? 'cancelled' : undefined,
});
const nameOf = (row: Row) => JSON.stringify(row);

/** What each list alone says, running or settled. */
const LIST_SAYS: Record<string, string> = { running: 'running', mixed: '2 running' };
const LIST_SETTLED: Record<string, string> = { failed: 'failed', stopped: 'stopped', 'mixed, settled': '1 failed' };

function expectedLabel(row: Row): string | null {
  if (row.pending) return 'needs-you';
  if (row.list in LIST_SAYS) return row.live ? LIST_SAYS[row.list]! : null;
  if (row.list in LIST_SETTLED) return LIST_SETTLED[row.list]!;
  if (row.result === 'error') return 'failed';
  if (row.cancelled) return 'stopped';
  const unlisted = row.list === 'null' || row.list === 'empty';
  return row.result === 'none' && row.sessionRuns && row.live && unlisted ? 'running' : null;
}

describe('every combination of the evidence', () => {
  it('is covered', () => {
    expect(ROWS).toHaveLength(2304);
    expect(new Set(ROWS.map(nameOf)).size).toBe(2304);
  });

  it('shows no label outside the list', () => {
    const shown = new Set(ROWS.map((row) => label(worldOf(row))));
    expect(shown).toEqual(new Set([null, 'needs-you', 'running', '2 running', 'failed', '1 failed', 'stopped']));
  });

  it('shows the label the rule names', () => {
    const wrong = ROWS.filter((row) => label(worldOf(row)) !== expectedLabel(row));
    expect(wrong.map(nameOf)).toEqual([]);
  });

  it('shows the call’s own text whatever else is known', () => {
    const own: Record<string, string> = { none: '', text: 'Two races.', error: 'It broke.' };
    const wrong = ROWS.filter((row) => describeWorld(worldOf(row)).result !== own[row.result]);
    expect(wrong.map(nameOf)).toEqual([]);
  });

  it('shows what others say only under a call with no text of its own, or launched in the background', () => {
    const summaries: Record<string, number> = { null: 0, empty: 0, mixed: 4, 'mixed, settled': 4 };
    const answers = { none: 0, one: 1, many: 2 };
    const wrong = ROWS.filter((row) => {
      const expected = row.result === 'none' || row.background ? (summaries[row.list] ?? 1) + answers[row.children] : 0;
      return describeWorld(worldOf(row)).reports.length !== expected;
    });
    expect(wrong.map(nameOf)).toEqual([]);
  });

  it('can stop only a task a live list says runs', () => {
    const wrong = ROWS.filter((row) => {
      const id = describeWorld(worldOf(row)).runningTask?.id;
      const expected = !row.live
        ? undefined
        : row.list === 'running'
          ? 'bg-0'
          : row.list === 'mixed'
            ? 'bg-1'
            : undefined;
      return id !== expected;
    });
    expect(wrong.map(nameOf)).toEqual([]);
  });
});

describe('status', () => {
  it.each([
    ['completed', null],
    ['failed', 'failed'],
    ['stopped', 'stopped'],
    ['running', 'running'],
  ] as const)('of a foreground call with an answer and a %s record is %s', (status, expected) => {
    expect(label({ result: 'Two races.', list: tasks(status), session: 'idle' })).toBe(expected);
  });

  it.each([
    [undefined, 'running'],
    ['pending', 'running'],
    ['in_progress', 'running'],
    ['completed', null],
    ['failed', null],
    ['cancelled', 'stopped'],
  ])('of a call with no result whose own part is %s, while the session runs, is %s', (acpStatus, expected) => {
    expect(label({ acpStatus, session: 'running', list: [] })).toBe(expected);
  });

  it('counts a turn being cancelled as running', () => {
    expect(label({ session: 'cancelling' })).toBe('running');
  });

  it('is none for a call whose result is empty', () => {
    expect(label({ result: '', session: 'running' })).toBeNull();
  });

  it('counts those of several that failed or were stopped, never those that finished', () => {
    expect(label({ list: tasks('completed', 'failed', 'failed', 'stopped') })).toBe('2 failed');
    expect(label({ list: tasks('completed', 'stopped', 'stopped') })).toBe('2 stopped');
    expect(label({ list: tasks('completed', 'completed') })).toBeNull();
  });

  it('goes by the task record before the call’s own error', () => {
    expect(label({ result: 'Interrupted.', error: true, list: tasks('stopped') })).toBe('stopped');
  });

  it('is of this agent’s requests only', () => {
    const other = { request: { toolUseId: 'elsewhere' } };
    const call = { messageId: 'm', part: { toolCallId: 'call-1', args: {}, messages: [step] } as never };
    const state = { runState: { type: 'idle' }, interactions: { permissions: { r: other } } };
    expect(describeAgent({ call, state: state as never, tasks: null }, true).status).toBeNull();
  });
});

describe('text', () => {
  it.each([
    'Async agent launched successfully.\nagentId: a1',
    'Spawned. The deployment is healthy.',
    '  The <error> tag is never closed.\n',
  ])('is the call’s own, verbatim: %j', (result) => {
    for (const background of BOTH)
      expect(describeWorld({ result, background, list: tasks('completed') }).result).toBe(result);
  });

  it('loses the CLI’s own tags around an error', () => {
    expect(describeWorld({ result: '<tool_use_error>No such agent</tool_use_error>', error: true }).result).toBe(
      'No such agent',
    );
  });

  it('names the source of each task’s summary, the earliest first, and skips empty ones', () => {
    const list = [task('completed', 3), task('failed', 1), task('completed', 2, ' ')];
    expect(reports({ result: 'Launched.', background: true, list })).toEqual([
      'Task summary: Summary 1',
      'Task summary: Summary 3',
    ]);
  });

  it.each([undefined, '', ' \n'])('counts %j as no text of the call’s own', (result) => {
    expect(reports({ result, list: tasks('completed') })).toEqual(['Task summary: Summary 0']);
  });

  it('is each child’s last final answer, in the order the children first answered', () => {
    const children = [
      said({ text: 'First of a.', thread: 'a', turn: '1' }, { text: 'Of b.', thread: 'b' }),
      said({ text: 'Last of a.', thread: 'a', turn: '2' }),
    ];
    expect(reports({ children })).toEqual(['Final answer: Last of a.', 'Final answer: Of b.']);
  });

  it.each([
    ['another agent’s', { parent: 'call-2' }],
    ['a comment on the way', { phase: 'commentary' }],
    ['cut short', { state: 'cancelled' }],
    ['still being written', { state: 'running' }],
  ])('is no final answer when it is %s', (_, piece) => {
    expect(reports({ children: [said({ text: 'Not it.', thread: 'a', ...piece })] })).toEqual([]);
  });
});
