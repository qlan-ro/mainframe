import { extraTools } from './transcript-extra-fixture';
import { exploration, tools } from './transcript-tools-fixture';

type Item = Record<string, unknown>;
export type Turn = (question: string, answer: string, minutes: number, calls?: Item[], durationMs?: number) => void;
export type Call = (id: string, title: string, input: Item, output: unknown, minutes: number, extra?: Item) => Item;
export type TranscriptFixture = keyof typeof fixtures;

function markers(turn: Turn, call: Call) {
  const question = 'Which window should reset first?';
  turn(
    'Next: plans, questions, skills, schedules, worktrees and notifications.',
    '**Plans, questions, skills, schedules, worktrees and notifications.** These are markers: pills on the spine that stay visible when the work folds. An answered question stays outside the work too.',
    13,
    [
      eventCalls(call)[0],
      call(
        'parity-plan',
        'ExitPlanMode',
        { plan: '### Weekly reset\n\n1. Report a window that has expired.' },
        'Updated plan',
        12.9,
      ),
      {
        ...call(
          'parity-question',
          'AskUserQuestion',
          { questions: [{ header: 'Reset order', question, options: [{ label: 'Weekly' }] }] },
          '',
          12.8,
        ),
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: '',
              _meta: {
                '_mainframe.dev': {
                  askUserQuestion: [{ question, answer: ['Weekly'], notes: 'the 5-hour window follows on its own' }],
                },
              },
            },
          },
        ],
      },
      call('parity-approved-plan', 'ExitPlanMode', {}, '## Approved Plan\n\n### Weekly reset', 12.75),
      ...eventCalls(call).slice(1),
    ],
  );
}
function agent(turn: Turn, call: Call) {
  turn(
    'Now tool calls, images and agents.',
    '**Tool calls, images and agents.** MCP and tools with no card share one row. A failed call opens by itself. Sub-agents list their steps as rows.',
    13,
    [
      call(
        'parity-agent',
        'Task',
        {
          description: 'Review the quota reset diff',
          prompt:
            'Review the uncommitted changes to mainframe-quota and use-quota.ts for correctness and test coverage.',
          subagent_type: 'code-reviewer',
        },
        'The diff is correct. One nit: QuotaWindow::reset drops resets_at, so the tooltip loses the next reset time until the following turn.',
        12.9,
        {
          subagent: true,
          toolCallTiming: { startedAt: Date.now() - 100_000, completedAt: Date.now() - 62_000 },
        },
      ),
      call(
        'parity-agent-step',
        'Bash',
        { command: 'git diff --stat' },
        ' crates/mainframe-quota/src/codex.rs       | 12 ++++++++----\n crates/mainframe-quota/src/codex_tests.rs | 24 ++++++++++++++++++++++++\n 2 files changed, 32 insertions(+), 4 deletions(-)',
        12.8,
        { parentToolCallId: 'parity-agent' },
      ),
    ],
  );
}
export const delegatedTasks = [
  { title: 'Check the mobile capsule', adapterId: 'codex', status: 'waiting' },
  { title: 'Write the weekly-window crate test', adapterId: 'claude', status: 'running', elapsed: 64 },
  { title: 'Update the changelog for v2.15.1', adapterId: 'codex', status: 'queued' },
  { title: 'Review the quota reset diff', adapterId: 'claude', status: 'completed', elapsed: 130 },
  { title: 'Regenerate the API types', adapterId: 'codex', status: 'failed', elapsed: 38 },
  { title: 'Draft the release notes', adapterId: 'claude', status: 'cancelled' },
  { title: 'Profile the capsule render', adapterId: 'codex', status: 'interrupted' },
].map((task) => ({
  ...task,
  taskId: `parity-task-${task.status}`,
  childChatId: `parity-child-${task.status}`,
}));

function delegated(turn: Turn, call: Call) {
  turn(
    'Now delegate work to other agents and show every state a delegated task can be in.',
    "**Delegated tasks.** Each runs in its own chat, which you can open beside this one. The row carries the task's live status: waiting on you, running, queued, completed, failed, stopped or interrupted. One waiting on you opens itself and its request appears above the composer.",
    13,
    delegatedTasks.map(({ taskId, childChatId, title, adapterId, status, elapsed }, index) => {
      const end = status === 'running' ? Date.now() : Date.now() - 60_000;
      const createdAt = elapsed === undefined ? undefined : new Date(end - elapsed * 1000).toISOString();
      const completedAt = elapsed === undefined || status === 'running' ? undefined : new Date(end).toISOString();
      return call(
        taskId,
        'mcp__mainframe__delegate_task',
        { task: title, adapterId },
        JSON.stringify({ taskId, childChatId, title, status, createdAt, completedAt }),
        12.9 - index / 100,
      );
    }),
  );
}

function links(turn: Turn) {
  turn(
    'Now show every markdown element a reply can use.',
    '# Weekly reset: what changed\n\nThe daemon now treats a window as reset once `resets_at` has passed. This paragraph shows **bold**, *italic*, ~~struck-through text~~, `inline code`, a [link to the Codex docs](https://developers.openai.com/codex/rate-limits) and a file link [crates/mainframe-quota/src/codex.rs](crates/mainframe-quota/src/codex.rs).[^1]\n\n[^1]: The 5-hour window behaves the same way; it was already covered by the existing test.',
    13,
  );
}
export const statusCommand = 'pnpm exec vitest run use-quota';

function states(turn: Turn, call: Call) {
  const run = (id: string, status: string, result?: string, durationMs?: number) => {
    const completedAt = Date.now() - 12 * 60_000;
    const toolCallTiming =
      durationMs === undefined
        ? { startedAt: Date.now() - 12_000 }
        : { startedAt: completedAt - durationMs, completedAt };
    return {
      ...call(id, 'Bash', { command: statusCommand }, result, 12.9, { toolCallTiming }),
      status,
    };
  };
  turn(
    'Last, show every status a row can have.',
    'Running, passed, failed, stopped, declined, waiting for approval, and no result recorded.',
    13,
    [
      run('parity-running', 'in_progress'),
      run('parity-passed', 'completed', '4 passed', 3100),
      run('parity-failed', 'failed', 'Exit code 1\nLint failed', 3100),
      run('parity-stopped', 'cancelled', undefined, 48000),
    ],
    3000,
  );
}
function eventCalls(call: Call): Item[] {
  return [
    call('parity-skill', 'Skill', { skill: 'mainframe-design-system' }, 'Loaded the design-system skill', 12.7),
    call('parity-wakeup', 'ScheduleWakeup', { delaySeconds: 1200 }, '{}', 12.6),
    call(
      'parity-cron-create',
      'CronCreate',
      { cron: '0 9 * * 1-5', prompt: 'Post the review status', recurring: true },
      '{"id":"cron_7f3a","humanSchedule":"weekdays at 09:00","recurring":true}',
      12.5,
    ),
    call('parity-cron-delete', 'CronDelete', { id: 'cron_7f3a' }, '{}', 12.4),
    call(
      'parity-cron-list',
      'CronList',
      {},
      JSON.stringify([
        { id: 'cron_7f3a', humanSchedule: 'weekdays 09:00', recurring: true, prompt: 'Post the review status' },
        { id: 'cron_91c2', humanSchedule: 'in 52m', prompt: 'Check the review-readiness run' },
        { id: 'cron_04de', humanSchedule: 'every 6h', recurring: true, prompt: 'Refresh the release notes' },
      ]),
      12.3,
    ),
    call(
      'parity-monitor',
      'Monitor',
      { command: 'pnpm dev', description: 'pnpm dev until "ready"' },
      'VITE v6.3.5  ready in 812 ms\n  ➜  Local:   http://localhost:5173/',
      12.2,
      { toolCallTiming: { startedAt: Date.now() - 100_000, completedAt: Date.now() - 58_000 } },
    ),
    call(
      'parity-enter-worktree',
      'EnterWorktree',
      { name: 'quota-reset' },
      '{"worktreeBranch":"feat/quota-reset"}',
      12.1,
    ),
    call(
      'parity-exit-worktree',
      'ExitWorktree',
      { action: 'keep' },
      '{"action":"keep","worktreeBranch":"feat/quota-reset"}',
      12,
    ),
    call(
      'parity-remove-worktree',
      'ExitWorktree',
      { action: 'remove' },
      '{"action":"remove","worktreeBranch":"feat/quota-reset"}',
      11.95,
    ),
    call(
      'parity-notify',
      'PushNotification',
      { message: 'Quota fix ready for review' },
      'Sent to your Mac and phone',
      11.9,
    ),
  ];
}

function awaitingApproval(turn: Turn, call: Call) {
  turn('Last, show every status a row can have.', '', 13, [
    call('parity-approval', 'Bash', { command: statusCommand }, undefined, 12.9),
  ]);
}

function todo(turn: Turn) {
  // The adapter display pipeline filters TodoWrite before the client receives history.
  turn('Track the quota reset', 'Updated the checklist.', 13);
}

const fixtures = {
  todo,
  markers,
  agent,
  delegated,
  links,
  states,
  tools,
  exploration,
  extraTools,
  awaitingApproval,
  'live command': states,
};

export function addTranscriptFixture(fixture: TranscriptFixture, turn: Turn, call: Call) {
  fixtures[fixture](turn, call);
}

export function recordedAnswer(messageId: string, endUtf16: number, durationMs: number) {
  return {
    presentationSources: {
      version: 1,
      sources: [
        {
          sourceMessageId: messageId,
          sourceBlockIndex: 0,
          target: { type: 'text', contentBlockIndex: 0, startUtf16: 0, endUtf16 },
          presentation: {
            version: 1,
            provider: 'claude',
            turnId: messageId,
            phase: 'final_answer',
            state: 'completed',
            finalEligible: true,
            timing: { durationMs },
          },
        },
      ],
    },
  };
}
