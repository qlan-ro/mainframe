// Session panel: the card, its sections, Activity, and the panel beside, over and behind other surfaces.
import { fail, openTab, parkPointer, renameChat, reload, seedWorkbench, stub, stubUsage } from '../seed.mts';
import { daemonFetch, fetchRoute } from '../../../../packages/e2e/fixtures/daemon.js';
import { sendMessage, waitForIdle } from '../../../../packages/e2e/helpers/tauri/wait.js';
import type { CaptureArea, CaptureContext } from '../types.mts';
import type { Page } from '../../../../packages/e2e/node_modules/@playwright/test/index.mjs';

const MINUTE = 60_000;
/** The docked card with the panel's own margin around it. */
const PANEL = { crop: 'session-panel', pad: 8 };
const TALL = { width: 1440, height: 1500 };

type Json = Record<string, unknown>;

/** Rewrites the `data` of a GET answer the daemon has only part of. */
async function patch(page: Page, url: RegExp, change: (data: never) => unknown): Promise<void> {
  await page.route(url, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await fetchRoute(route);
    const body = (await response.json()) as { data: never };
    await route.fulfill({ response, json: { ...body, data: change(body.data) } });
  });
}

/** The chat the stubs answer for, set by each group's seed. */
let parent = '';

const task = (id: string, kind: string, description: string, minutesAgo: number, extra: Json = {}) => ({
  id,
  kind,
  toolName: 'Bash',
  toolUseId: `toolu_${id}`,
  command: '',
  description,
  outputPath: null,
  startedAt: Date.now() - minutesAgo * MINUTE - MINUTE / 2,
  endedAt: null,
  status: 'running',
  lastOutputLine: null,
  summary: null,
  usage: null,
  ...extra,
});
const ended = (id: string, kind: string, description: string, status: string, extra: Json = {}) => ({
  ...task(id, kind, description, 90, extra),
  endedAt: Date.now() - 60 * MINUTE,
  status,
});

const LIVE_TASKS = () => [
  task('a1', 'agent', 'Review the quota reset diff', 4),
  task('wf1', 'workflow', 'release-checks', 3, { workflowName: 'release-checks' }),
  task('m1', 'bash', 'pnpm dev until "ready"', 5, { toolName: 'Monitor', command: 'pnpm dev' }),
  task('c1', 'bash', 'pnpm test --run', 1, { command: 'pnpm test --run' }),
];
const FINISHED_TASKS = () => [
  ended('e1', 'agent', 'Explore the rate-limit sources', 'completed'),
  ended('e2', 'workflow', 'nightly-audit', 'completed', { workflowName: 'nightly-audit' }),
  ended('e3', 'agent', 'Translate the release notes', 'failed'),
  ended('e4', 'agent', 'Profile the capsule render', 'stopped'),
];

const OUTPUT = ' RUN  v5.1.1\n\n ✓ src/quota/reset.test.ts (12 tests) 48ms\n ✓ src/quota/usage.test.ts (9 tests) 31ms\n   src/panel/rows.test.ts …';

const CHILDREN = [
  { title: 'Check the mobile capsule', status: 'running', displayStatus: 'waiting' },
  { title: 'Write the weekly-window crate test', status: 'running' },
  { title: 'Update the changelog for v2.15.1', status: 'queued' },
  { title: 'Regenerate the API types', status: 'failed' },
];

const agent = (agentId: string, phaseIndex: number, label: string, state: string, seconds: number) => ({
  agentId,
  index: 0,
  phaseIndex,
  label,
  state,
  tokens: 0,
  toolCalls: 3,
  durationMs: seconds * 1_000,
});
const RUNS = [
  {
    taskId: 'wf1',
    runId: 'wf_release_checks',
    workflowName: 'release-checks',
    status: 'running',
    source: 'snapshot',
    totalTokens: 18_400,
    durationMs: 3 * MINUTE,
    phases: ['Lint', 'Typecheck', 'Test', 'Build'].map((title, index) => ({ index, title })),
    agents: [
      agent('lint', 0, 'Lint every package', 'done', 18),
      agent('ui', 1, 'Typecheck packages/ui', 'progress', 72),
      agent('rs', 1, 'Typecheck packages/core-rs', 'progress', 48),
    ],
  },
];

const FILE = (n: number, name: string) => ({ id: `att-${n}`, name, mediaType: 'text/plain', sizeBytes: 2_048, kind: 'file' });
const MENTION = (path: string) => ({ id: path, kind: 'file', name: path, path, source: 'user', timestamp: '2026-11-24T10:00:00Z' });
const CONTEXT = {
  globalFiles: [{ path: '/Users/me/.claude/CLAUDE.md', content: 'x'.repeat(1_672), source: 'global' }],
  projectFiles: [{ path: 'CLAUDE.md', content: 'x'.repeat(212), source: 'project' }],
  mentions: [MENTION('docs/review-workflow.md'), MENTION('src/git.ts')],
  attachments: [FILE(1, 'usage.csv'), FILE(2, 'notes.md')],
  modifiedFiles: ['src/codex.rs', 'src/codex_tests.rs', 'src/use-quota.ts', 'docs/quota.md', 'src/usage.ts'],
  skillFiles: [
    { path: '/skills/mainframe-design-system/SKILL.md', displayName: 'mainframe-design-system' },
    { path: '/skills/ui-design/SKILL.md', displayName: 'ui-design' },
  ],
};
const MANY_FILES = ['usage.csv', 'notes.md', 'quota.json', 'trace.log', 'plan.pdf', 'codex.rs', 'hook.ts'];

async function stubSession(page: Page, options: { tasks?: () => unknown[]; children?: boolean; context?: Json } = {}) {
  await stubUsage(page);
  const { tasks = () => [], children = false, context = CONTEXT } = options;
  await stub(page, /\/api\/chats\/[^/]+\/context$/, context);
  await stub(page, /\/api\/chats\/[^/]+\/workflow-runs$/, RUNS);
  await page.route(/\/background-tasks\/c1\/output/, (route) =>
    route.fulfill({
      body: OUTPUT,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'x-output-truncated',
        'x-output-truncated': 'true',
      },
    }),
  );
  await page.route(/\/api\/chats\/[^/]+\/background-tasks$/, (route) =>
    route.fulfill({ json: { success: true, data: { tasks: tasks() } }, headers: { 'access-control-allow-origin': '*' } }),
  );
  await patch(page, /\/api\/chats(\?.*)?$/, (chats: Json[]) => {
    const session = chats.find((chat) => chat['id'] === parent);
    if (!session) return chats;
    const own = chats.map((chat) =>
      chat === session
        ? {
            ...chat,
            detectedPrs: [
              { url: 'https://github.com/acme/atlas-web/pull/912', owner: 'acme', repo: 'atlas-web', number: 912, source: 'created' },
            ],
          }
        : chat,
    );
    if (!children) return own;
    return [
      ...own,
      ...CHILDREN.map(({ title, status, displayStatus }, n) => ({
        ...session,
        id: `child-${n}`,
        title,
        parentChatId: parent,
        displayStatus: displayStatus ?? 'idle',
        delegation: { taskId: `task-${n}`, role: 'review', status },
      })),
    ];
  });
}

async function addProjectTasks(projectId: string, titles: string[]) {
  for (const title of titles)
    await daemonFetch('/api/plugins/todos/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title }),
    });
}

const LAUNCH = {
  version: '1.0',
  configurations: [
    { name: 'ui-dev', runtimeExecutable: 'sleep', runtimeArgs: ['60'], preview: true, port: 5173 },
    { name: 'daemon', runtimeExecutable: 'sleep', runtimeArgs: ['60'] },
    { name: 'typecheck', runtimeExecutable: 'sleep', runtimeArgs: ['60'] },
    { name: 'storybook-design-system-preview', runtimeExecutable: 'sleep', runtimeArgs: ['60'] },
  ],
};

const TITLE = 'Fix stuck Codex limits in the usage capsule';

/** The workbench with the last session open, one turn in, and everything the panel lists. */
async function seedSession({ page, vars }: CaptureContext, turn?: string) {
  const bench = await seedWorkbench(page);
  parent = bench.chats[bench.chats.length - 1]!;
  vars['chat'] = parent;
  vars['project'] = bench.atlas;
  await stub(page, /\/launch\/configs(\?.*)?$/, LAUNCH.configurations);
  await patch(page, /\/launch\/status(\?.*)?$/, (data: Json) => ({ ...data, statuses: { daemon: 'running' } }));
  await addProjectTasks(bench.atlas, [
    'Preview captures do not send from a detached tab',
    'Remember file tree expansion state',
    'Resume the last permission mode after a restart',
  ]);
  if (turn) {
    await sendMessage(page, turn);
    await waitForIdle(page, 60_000);
  }
  await renameChat(page, parent, TITLE);
  await reload(page);
  await openTab(page, parent);
  await closeWorkspace(page);
  await page.getByTestId('session-panel-card-tasks').waitFor();
  await parkPointer(page);
}

/** A running launch configuration opens its console in the workspace, which parks the panel (W6). */
async function closeWorkspace(page: Page) {
  const workspace = page.getByTestId('workspace-surface');
  await workspace.waitFor();
  await page.keyboard.press('ControlOrMeta+Shift+W');
  await workspace.waitFor({ state: 'detached' });
}

const PLAN_TURN = 'Track two todos: write the README, then run the test suite';
const SCHEDULE_TURN = 'Schedule a wakeup, create a cron job, list schedules, delete one, and monitor the build';

async function closeMenu(page: Page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
  await parkPointer(page);
}

const area: CaptureArea = {
  boards: [
    {
      file: 'Chat-SessionPanel-States',
      title: 'Session panel — sections',
      subtitle: 'The card fits its content, capped at the chat area. Rows R1–R10 and R12.',
      width: 1700,
    },
    {
      file: 'Chat-SessionPanel-ActivitySection',
      title: 'Session panel — Activity',
      subtitle: 'The kind icon leads, the status sits at the end (R6, R13).',
      width: 1400,
    },
    {
      file: 'Chat-SessionPanel-Modes',
      title: 'Session panel — docked, floating, hidden',
      subtitle: 'Docks from a 1044 px chat column, otherwise floats above the composer (R11).',
      width: 4400,
    },
    {
      file: 'Chat-SessionPanel-ActivityWindow',
      title: 'Session panel — from a row to the transcript',
      subtitle: 'Monitors, background commands and schedules go to their transcript row (R13).',
      width: 3000,
    },
    { file: 'Workspace-SessionPanel', title: 'Workspace — floating session panel', subtitle: 'R11, W6.', width: 3000 },
    {
      file: 'Chat-SessionPanel-ActivityError',
      title: 'Session panel — Activity could not load',
      subtitle: 'The error label is muted rose (`fail`, S6).',
      width: 1000,
    },
  ],
  groups: [
    {
      board: 'Chat-SessionPanel-States',
      viewport: TALL,
      launch: { recordingKey: 'todo-write' },
      before: (page) => stubSession(page, { tasks: () => LIVE_TASKS().slice(0, 2) }),
      seed: (ctx) => seedSession(ctx, PLAN_TURN),
      states: [
        {
          id: 'docked',
          caption: '**Docked.** “Session” and the Sections button, then one section per kind of thing. Hairlines are inset to the text.',
          ...PANEL,
        },
        {
          id: 'sections-menu',
          caption: '**Sections menu.** Each section on or off, remembered for this viewer.',
          crop: [1124, 48, 316, 852],
          setup: async ({ page }) => {
            await page.getByTestId('session-panel-sections-menu').click();
            await page.getByTestId('session-panel-sections-menu-tasks').waitFor();
            await parkPointer(page);
          },
        },
        {
          id: 'sections-off',
          caption: '**Sections turned off.** The card shrinks to what is left.',
          ...PANEL,
          setup: async ({ page }) => {
            for (const key of ['launch', 'memory', 'skills', 'tasks'])
              await page.getByTestId(`session-panel-sections-menu-${key}`).click();
            await closeMenu(page);
          },
        },
        {
          id: 'plan-open',
          caption: '**Plan and files open.** Every step with its state; every file with why it is here.',
          ...PANEL,
          setup: async ({ page }) => {
            await page.getByTestId('session-panel-plan-toggle').click();
            await page.getByTestId('session-panel-mentions-all').click();
            await parkPointer(page);
          },
        },
      ],
    },
    {
      board: 'Chat-SessionPanel-States',
      viewport: TALL,
      before: (page) =>
        stubSession(page, {
          context: { ...CONTEXT, attachments: MANY_FILES.map((name, n) => FILE(n, name)), skillFiles: [] },
        }),
      seed: (ctx) => seedSession(ctx),
      states: [
        {
          id: 'attachments',
          caption: '**Attachments overflow.** One row of tiles ending in “+N”.',
          crop: 'session-panel-section-attachments',
          pad: 12,
        },
        {
          id: 'attachments-all',
          caption: '**Expanded.**',
          crop: 'session-panel-section-attachments',
          pad: 12,
          setup: async ({ page }) => {
            await page.getByTestId('session-panel-attachments-more').click();
            await parkPointer(page);
          },
        },
        {
          id: 'launch-failed',
          caption: '**Launch.** Running ends in Stop, starting spins, a failed run says so and can start again.',
          crop: 'session-panel-card-launch',
          pad: 12,
          setup: async ({ page, vars }) => {
            await page.unroute(/\/launch\/status(\?.*)?$/);
            await patch(page, /\/launch\/status(\?.*)?$/, (data: Json) => ({
              ...data,
              statuses: { daemon: 'running', typecheck: 'starting', 'storybook-design-system-preview': 'failed' },
            }));
            await reload(page);
            await openTab(page, vars['chat']!);
            await closeWorkspace(page);
            await page.getByTestId('session-panel-launch-spinner-typecheck').waitFor();
            await parkPointer(page);
          },
        },
        {
          id: 'skills-empty',
          caption: '**No skills used.** The section stays, because Manage lives here.',
          crop: 'session-panel-section-skills',
          pad: 12,
        },
        {
          id: 'before-first-message',
          caption: '**Before the first message.** Project-level sections only.',
          ...PANEL,
          setup: async ({ page, vars }) => {
            await page.getByTestId('sidebar-action-new-thread').click();
            await page.getByTestId('welcome-project').click();
            await page.getByTestId(`welcome-project-${vars['project']}`).click();
            await page.getByTestId('session-panel-tasks-new').waitFor();
            await parkPointer(page);
          },
        },
      ],
    },
    {
      board: 'Chat-SessionPanel-ActivitySection',
      viewport: TALL,
      launch: { recordingKey: 'schedule-pills' },
      before: (page) => stubSession(page, { tasks: () => [...LIVE_TASKS(), ...FINISHED_TASKS()], children: true }),
      seed: (ctx) => seedSession(ctx, SCHEDULE_TURN),
      states: [
        {
          id: 'every-kind',
          caption: '**Ongoing work.** Needs you first, then running, queued, scheduled. Finished work waits under Earlier with its failed count.',
          crop: 'session-panel-card-activity',
          pad: 12,
        },
        {
          id: 'workflow',
          caption: '**A workflow unfolds.** Its phases, the running phase’s agents, and Stop where the adapter can stop a task (the mock one can’t). No other row unfolds.',
          crop: 'session-panel-card-activity',
          pad: 12,
          setup: async ({ page }) => {
            await page.getByTestId('session-panel-activity-task:wf1').click();
            await parkPointer(page);
          },
        },
        {
          id: 'earlier',
          caption: '**Earlier open.** The kind icon stays; the value is the time it ended, or failed, stopped, removed.',
          crop: 'session-panel-card-activity',
          pad: 12,
          setup: async ({ page }) => {
            await page.getByTestId('session-panel-activity-task:wf1').click();
            await page.getByTestId('session-panel-activity-earlier').click();
            await parkPointer(page);
          },
        },
        {
          id: 'row-stop',
          caption: '**Hover or focus.** A row that can be stopped shows Stop in place of its value (until K4), and a background command its full output.',
          crop: 'session-panel-card-activity',
          pad: 12,
          setup: async ({ page }) => {
            await page.getByTestId('session-panel-activity-earlier').click();
            await page.getByTestId('session-panel-activity-delegated:task-1').hover();
            // The row's own tooltip would cover the rows below it.
            await page.addStyleTag({ content: '[data-slot="tooltip-content"]{display:none}' });
          },
        },
        {
          id: 'command-menu',
          caption: '**A background command’s menu** has its full output, until its transcript row shows it.',
          crop: [1040, 48, 400, 852],
          setup: async ({ page }) => {
            await page.getByTestId('session-panel-activity-task:c1').click({ button: 'right' });
            await page.getByTestId('session-panel-activity-output-task:c1').waitFor();
          },
        },
        {
          id: 'command-output',
          caption: '**Full output.** Up to its last 1 MB; it says when the start is left out. It stays open when the command ends.',
          crop: 'session-panel-output-dialog',
          pad: 12,
          setup: async ({ page }) => {
            await page.getByTestId('session-panel-activity-output-task:c1').click();
            await page.getByTestId('session-panel-output-text').waitFor();
            await parkPointer(page);
          },
        },
        {
          id: 'row-menu',
          caption: '**Right-click.** Stop while the work can be stopped, and Show in transcript where the history holds its call (not for this task).',
          crop: [1040, 48, 400, 852],
          setup: async ({ page }) => {
            await page.keyboard.press('Escape');
            await page.getByTestId('session-panel-output-dialog').waitFor({ state: 'detached' });
            await page.getByTestId('session-panel-activity-delegated:task-1').click({ button: 'right' });
            await page.getByTestId('session-panel-activity-stop-delegated:task-1').waitFor();
          },
        },
      ],
    },
    {
      board: 'Chat-SessionPanel-ActivitySection',
      before: (page) => stubSession(page),
      seed: (ctx) => seedSession(ctx),
      states: [
        { id: 'empty', caption: '**Nothing yet.**', crop: 'session-panel-card-activity', pad: 12 },
      ],
    },
    {
      board: 'Chat-SessionPanel-Modes',
      launch: { recordingKey: 'todo-write' },
      before: (page) => stubSession(page, { tasks: LIVE_TASKS }),
      seed: (ctx) => seedSession(ctx, PLAN_TURN),
      states: [
        { id: 'docked', caption: '**Docked.** The chat column has room for both.' },
        {
          id: 'hidden',
          caption: '**Closed.** The toggle in the session header opens it again.',
          setup: async ({ page }) => {
            await page.getByTestId('session-panel-toggle').click();
            await page.getByTestId('session-panel-root').waitFor({ state: 'detached' });
            await parkPointer(page);
          },
        },
      ],
    },
    {
      board: 'Chat-SessionPanel-Modes',
      viewport: { width: 1180, height: 900 },
      launch: { recordingKey: 'todo-write' },
      before: (page) => stubSession(page, { tasks: LIVE_TASKS }),
      seed: async (ctx) => {
        await ctx.page.setViewportSize({ width: 1440, height: 900 });
        await seedSession(ctx, PLAN_TURN);
        await ctx.page.setViewportSize({ width: 1180, height: 900 });
        await ctx.page.getByTestId('session-panel-root').waitFor({ state: 'detached' });
      },
      states: [
        {
          id: 'floating',
          caption: '**Floating on a narrow column.** It ends 8 px above the composer, which stays usable. Esc, or a press outside, parks it again.',
          setup: async ({ page }) => {
            await page.getByTestId('session-panel-toggle').click();
            await page.getByTestId('session-panel-overlay').waitFor();
            await parkPointer(page);
          },
        },
      ],
    },
    {
      board: 'Chat-SessionPanel-ActivityWindow',
      launch: { recordingKey: 'schedule-pills' },
      before: (page) => stubSession(page, { tasks: LIVE_TASKS, children: true }),
      seed: (ctx) => seedSession(ctx, SCHEDULE_TURN),
      states: [
        {
          id: 'jump',
          caption: '**A schedule row was clicked.** Its marker is scrolled into view and highlighted for about two seconds.',
          setup: async ({ page }) => {
            await page.getByTestId('session-panel-activity-schedule:toolu_sched_1').click();
            await page.locator('[data-activity-flash]').waitFor();
          },
          wait: 400,
        },
      ],
    },
    {
      board: 'Workspace-SessionPanel',
      launch: { recordingKey: 'todo-write' },
      before: (page) => stubSession(page, { tasks: LIVE_TASKS }),
      seed: (ctx) => seedSession(ctx, PLAN_TURN),
      states: [
        {
          id: 'parked',
          caption: '**Workspace open.** The narrower chat column parks the panel (W6).',
          setup: async ({ page }) => {
            await page.keyboard.press('ControlOrMeta+Shift+W');
            await page.getByTestId('workspace-surface').waitFor();
            await page.getByTestId('session-panel-root').waitFor({ state: 'detached' });
            await parkPointer(page);
          },
        },
        {
          id: 'floating',
          caption: '**The toggle floats it over the chat column.**',
          setup: async ({ page }) => {
            await page.getByTestId('session-panel-toggle').click();
            await page.getByTestId('session-panel-overlay').waitFor();
            await parkPointer(page);
          },
        },
      ],
    },
    {
      board: 'Chat-SessionPanel-ActivityError',
      before: async (page) => {
        await stubUsage(page);
        await fail(page, /\/api\/chats\/[^/]+\/background-tasks$/, 'the daemon did not answer');
      },
      seed: async ({ page }) => {
        await seedWorkbench(page);
        await page.getByText('Could not load earlier tasks').waitFor();
      },
      states: [
        {
          id: 'activity-load-error',
          caption: '**Earlier tasks did not load.** The section says why and keeps its other rows.',
          crop: [1124, 48, 316, 560],
        },
      ],
    },
  ],
};

export default area;
