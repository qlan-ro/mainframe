type Item = Record<string, unknown>;
type Turn = (question: string, answer: string, minutes: number, calls?: Item[]) => void;
type Call = (id: string, title: string, input: Item, output: unknown, minutes: number, extra?: Item) => Item;
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
          prompt: 'Review it',
          subagent_type: 'code-reviewer',
          run_in_background: true,
        },
        undefined,
        12.9,
      ),
    ],
  );
}
function links(turn: Turn) {
  turn(
    'Now show every markdown element a reply can use.',
    '# Weekly reset: what changed\n\nThe daemon now treats a window as reset once `resets_at` has passed. This paragraph shows **bold**, *italic*, ~~struck-through text~~, `inline code`, a [link to the Codex docs](https://developers.openai.com/codex/rate-limits) and a file link [crates/mainframe-quota/src/codex.rs](crates/mainframe-quota/src/codex.rs).',
    13,
  );
}
function states(turn: Turn, call: Call) {
  const run = (id: string, status: string, result?: string, toolCallTiming?: Item) => ({
    ...call(id, 'Bash', { command: 'pnpm exec vitest run use-quota' }, result, 12.9, { toolCallTiming }),
    status,
  });
  turn(
    'Last, show every status a row can have.',
    'Running, passed, failed, stopped, declined, waiting for approval, and no result recorded.',
    13,
    [
      run('parity-running', 'in_progress'),
      run('parity-passed', 'completed', '4 passed', { durationMs: 3100 }),
      run('parity-failed', 'failed', 'Exit code 1\nLint failed', { durationMs: 3100 }),
      run('parity-stopped', 'cancelled', undefined, { durationMs: 48000 }),
      run('parity-no-result', 'completed'),
    ],
  );
}
function tools(turn: Turn, call: Call) {
  turn(
    'Walk me through every kind of tool card the transcript can show. Start with files, searches, edits, commands and the web.',
    '**Files, searches, edits, commands and the web.** Every row has the same shape: glyph, verb, target, receipt. Click any row with a chevron to open it.',
    13,
    [
      call(
        'parity-read',
        'Read',
        { file_path: 'quota/use-quota.ts' },
        [
          'export function useQuota(adapterId: string) {',
          '  return useQuery({',
          "    queryKey: ['quota', adapterId],",
          '    queryFn: () => api.quota.snapshot(adapterId),',
          '    refetchInterval: pollInterval,',
          '    staleTime: minute,',
          '  });',
          '}',
        ].join('\n'),
        12.9,
      ),
      call(
        'parity-write',
        'Write',
        { file_path: 'src/codex_tests.rs', content: 'use super::*;' },
        'File created',
        12.8,
      ),
      call(
        'parity-edit',
        'Edit',
        { file_path: 'src/codex.rs', old_string: 'return None;', new_string: 'return Some(window);' },
        'File updated',
        12.7,
      ),
      call(
        'parity-grep',
        'Grep',
        { pattern: 'resets_at', path: 'packages/core-rs' },
        'src/codex.rs:21: pub resets_at: i64',
        12.6,
      ),
      call(
        'parity-glob',
        'Glob',
        { pattern: '**/quota*.rs', path: 'packages/core-rs' },
        ['quota.rs', 'quota_window.rs', 'routes/quota.rs', 'quota_tests.rs'].join('\n'),
        12.5,
      ),
      ...shellAndExternalCalls(call),
    ],
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
      'ready in 812 ms',
      12.2,
    ),
    call(
      'parity-enter-worktree',
      'EnterWorktree',
      { name: 'quota-reset' },
      '{"worktreeBranch":"feat/quota-reset"}',
      12.1,
    ),
    call('parity-exit-worktree', 'ExitWorktree', { action: 'keep' }, '{"action":"keep"}', 12),
    call(
      'parity-notify',
      'PushNotification',
      { message: 'Quota fix ready for review' },
      'Sent to your Mac and phone',
      11.9,
    ),
  ];
}

function shellAndExternalCalls(call: Call): Item[] {
  return [
    call('parity-bash', 'Bash', { command: 'cargo test -p mainframe-quota codex' }, 'test result: ok. 4 passed', 12.4),
    call(
      'parity-fetch',
      'WebFetch',
      { url: 'https://developers.openai.com/codex/rate-limits', prompt: 'Find the rate limits' },
      'Limits reset at the end of each window.',
      12.3,
    ),
    call('parity-search', 'WebSearch', { query: 'codex rate limit reset' }, 'Rate limits · OpenAI Codex docs', 12.2),
    call(
      'parity-list',
      'LS',
      { path: 'packages/core-rs/crates' },
      'mainframe-adapter-claude/ mainframe-adapter-codex/ mainframe-chat/',
      12.1,
    ),
    call(
      'parity-mcp',
      'mcp__github__get_issue',
      { owner: 'qlan-ro', repo: 'mainframe', issue_number: 847 },
      '{"title":"Reset stale quota windows"}',
      12,
    ),
    call(
      'parity-lsp',
      'LSP',
      { operation: 'findReferences', filePath: 'src/codex.rs', line: 32 },
      '3 references to snapshot',
      11.9,
    ),
    call('parity-dynamic', 'docs__search', { query: 'rate limits' }, 'Rate limits · OpenAI Codex docs', 11.8),
  ];
}

const fixtures = { markers, agent, links, states, tools };

export function addTranscriptFixture(fixture: TranscriptFixture, turn: Turn, call: Call) {
  fixtures[fixture](turn, call);
}
