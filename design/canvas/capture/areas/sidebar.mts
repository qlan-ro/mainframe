// Sidebar: the session list's rows, states and menus, the other sidebar views, and editing errors.
import { assertOwnDaemon, fetchRoute } from '../../../../packages/e2e/fixtures/daemon.js';
import { waitConnected } from '../../../../packages/e2e/helpers/tauri/wait.js';
import type { Page, WebSocketRoute } from '../../../../packages/e2e/node_modules/@playwright/test/index.mjs';
import { escape, parkPointer, reload, seedChat, seedProject, seedWorkbench, stubUsage } from '../seed.mts';
import type { CaptureArea, CaptureContext, CaptureState, Crop } from '../types.mts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Over = Record<string, unknown>;

/** Title, project, age, and what the mock daemon has no source for (statuses, PRs, lineage, ages). */
const LIST: [title: string, project: 'atlas' | 'ledger', ago: number, over: Over][] = [
  ['Reconcile the November export', 'ledger', 9 * DAY, { tags: ['urgent'] }],
  ['Order the scope strip by most recent use', 'atlas', 6 * DAY, {}],
  ['Document the webhook retries', 'ledger', 3 * DAY, {}],
  [
    'Add idempotency keys to transfers',
    'ledger',
    DAY + 4 * MINUTE,
    { worktreePath: '/gone/keys', worktreeMissing: true },
  ],
  ['Keep the cart badge in sync', 'atlas', DAY, { tags: ['bug'] }],
  ['What does CORS preflight cache?', 'atlas', 90 * MINUTE, { noProject: true, temporary: true }],
  ['Pair a device over the local network', 'atlas', 8 * DAY, { pinned: true }],
  ['Try the checkout fix without retries', 'atlas', 70 * MINUTE, {}],
  ['Fix the flaky checkout test', 'atlas', 60 * MINUTE, {}],
  ['Trim the bundle below 300 kB before the release freeze', 'atlas', 31 * MINUTE, { displayStatus: 'waiting' }],
  ['Audit the transfer limits', 'ledger', 18 * MINUTE, { displayStatus: 'working', delegatedWaiting: true }],
  [
    'Show refunds in the statement',
    'ledger',
    7 * MINUTE,
    {
      worktreePath: '/Users/dev/Code/ledger-api/.worktrees/refunds',
      branchName: 'feat/refunds',
      tags: ['bug', 'urgent'],
      detectedPrs: [
        {
          url: 'https://github.com/acme/ledger-api/pull/412',
          owner: 'acme',
          repo: 'ledger-api',
          number: 412,
          source: 'created',
        },
      ],
    },
  ],
  ['Review the statement totals', 'ledger', 4 * MINUTE, { displayStatus: 'working' }],
  ['Where is greeting defined?', 'atlas', 2 * MINUTE, {}],
];
const FORK = ['Try the checkout fix without retries', 'Fix the flaky checkout test'] as const;

/** Answers the session list with LIST's fields on top of the daemon's own chats. */
async function dressList(page: Page): Promise<void> {
  const byTitle = new Map(LIST.map(([title, , ago, over]) => [title, { ago, over }]));
  await page.route(/\/api\/chats(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await fetchRoute(route);
    const body = (await response.json()) as { data: (Over & { id: string; title?: string })[] };
    const parent = body.data.find((chat) => chat.title === FORK[1]);
    const now = Date.now();
    body.data = body.data.map((chat) => {
      const row = byTitle.get(chat.title ?? '');
      if (!row) return chat;
      const fork = chat.title === FORK[0] && parent ? { parentChatId: parent.id } : {};
      return { ...chat, ...row.over, ...fork, updatedAt: new Date(now - row.ago).toISOString() };
    });
    await route.fulfill({ response, json: body });
  });
}

const sockets = new WeakMap<Page, WebSocketRoute[]>();

/** The daemon's socket, passed through, so a state can also deliver an event of its own. */
async function tapSocket(page: Page): Promise<void> {
  const open: WebSocketRoute[] = [];
  sockets.set(page, open);
  // Not the ACP socket, which carries JSON-RPC only.
  await page.routeWebSocket(
    (url) => !url.pathname.includes('acp'),
    (ws) => {
      assertOwnDaemon();
      ws.connectToServer();
      open.push(ws);
    },
  );
}

function deliver(page: Page, event: Over): void {
  for (const ws of sockets.get(page) ?? []) ws.send(JSON.stringify(event));
}

const row = (page: Page, title: string) => page.getByTestId('sessions-row').filter({ hasText: title });

const UNREAD = 'Show refunds in the statement';

async function before(page: Page): Promise<void> {
  await stubUsage(page);
  await tapSocket(page);
  await dressList(page);
}

async function list({ page, vars }: CaptureContext): Promise<void> {
  const ids = { atlas: await seedProject('atlas-web'), ledger: await seedProject('ledger-api') };
  await seedProject('mobile-app');
  vars['atlas'] = ids.atlas;
  await reload(page);
  for (const [title, project] of LIST) vars[title] = await seedChat(page, ids[project], title);
  await page.reload();
  await waitConnected(page);
  await row(page, 'Where is greeting defined?').click();
  deliver(page, { type: 'chat.notification', chatId: vars[UNREAD], title: 'Done', body: 'Done', level: 'success' });
  await row(page, UNREAD).locator('[data-unread]').waitFor();
  await parkPointer(page);
}

/** The whole sidebar panel, without the rail. */
const PANEL: Crop = [57, 49, 259, 851];
/** The panel and the space a menu or a hover card takes beside it. */
const BESIDE: Crop = [57, 49, 663, 560];

function rowState(id: string, caption: string, title: string, act?: (page: Page) => Promise<void>): CaptureState {
  return {
    id,
    caption,
    crop: async (page) => {
      const box = (await row(page, title).boundingBox())!;
      return [57, Math.floor(box.y), 259, 28];
    },
    setup: async ({ page }) => {
      await escape(page);
      await act?.(page);
    },
  };
}

async function card(page: Page, title: string): Promise<void> {
  await escape(page);
  // The previous card lingers past the pointer; it must not stand in for this one.
  await page.getByTestId('sessions-meta-card').waitFor({ state: 'detached' });
  await row(page, title).hover();
  await page.getByTestId('sessions-meta-card-title').filter({ hasText: title }).waitFor();
}

/** The first group's header, with the row under it. */
async function headerCrop(page: Page): Promise<Crop> {
  const box = (await page.getByTestId('sessions-section-jump').boundingBox())!;
  return [57, Math.floor(box.y) - 12, 259, 76];
}

function view(id: string, caption: string): CaptureState {
  return {
    id: `view-${id}`,
    caption,
    crop: PANEL,
    wait: 800,
    setup: async ({ page }) => {
      await escape(page);
      await page.getByTestId(`shell-rail-${id}`).click();
      await parkPointer(page);
    },
  };
}

const area: CaptureArea = {
  boards: [
    {
      file: 'Shell-SidebarViews',
      title: 'Shell — sidebar views',
      subtitle: 'What the rail puts in the sidebar.',
      width: 2400,
    },
    {
      file: 'Shell-SidebarRows',
      title: 'Shell — session rows and group headers',
      subtitle: 'Project letter, title, one trailing value (L1, L3). Rows 28 px, headers 24 px with 14 px above (L4).',
      width: 1600,
    },
    {
      file: 'Shell-SidebarStates',
      title: 'Shell — session list states',
      subtitle: 'The whole panel, as the list filters, scrolls and empties.',
      width: 2400,
    },
    {
      file: 'Shell-SidebarMenus',
      title: 'Shell — sidebar menus and hover cards',
      subtitle: 'Group actions appear on hover or keyboard focus. What a row leaves out is in its hover card (L2).',
      width: 2400,
    },
    {
      file: 'Shell-SidebarErrors',
      title: 'Shell — sidebar: editing and errors',
      subtitle: 'Renaming a session in place, and a tag name that is not allowed.',
      width: 1500,
    },
  ],
  groups: [
    {
      board: 'Shell-SidebarRows',
      before,
      seed: list,
      states: [
        rowState('row-idle', '**Idle.** The time.', 'Fix the flaky checkout test'),
        rowState('row-selected', '**Selected.** A neutral fill.', 'Where is greeting defined?'),
        rowState(
          'row-hover',
          '**Hover.** Pin, tag and archive sit before the trailing value.',
          'Fix the flaky checkout test',
          async (page) => row(page, 'Fix the flaky checkout test').hover(),
        ),
        rowState(
          'row-running',
          '**Running**, or sub-agents still running after the turn: the same spinner, no count.',
          'Review the statement totals',
        ),
        rowState('row-needs-you', '**Needs you.** A permission, question or plan waits.', 'Trim the bundle below'),
        rowState(
          'row-needs-you-running',
          '**Needs you outranks running.** A delegated task waits while the turn runs.',
          'Audit the transfer limits',
        ),
        rowState('row-unread', '**Unread response.** The title turns semibold.', UNREAD),
        rowState('row-no-project', '**No project.** “–” leads.', 'What does CORS preflight cache?'),
        rowState('row-fork', '**Fork.** Indented under its parent.', FORK[0]),
        rowState('row-focus', '**Keyboard focus.**', 'Fix the flaky checkout test', async (page) => {
          await row(page, 'Fix the flaky checkout test').locator('button').first().focus();
          await page.keyboard.press('Shift+Tab');
          await page.keyboard.press('Tab');
        }),
        {
          id: 'header-rest',
          caption: '**Group header at rest.** The label alone.',
          crop: headerCrop,
          setup: async ({ page }) => escape(page),
        },
        {
          id: 'header-hover',
          caption: '**Hovered.** Filter, Sort and More appear.',
          crop: headerCrop,
          setup: async ({ page }) => page.getByTestId('sessions-section-jump').hover(),
        },
        {
          id: 'header-focus',
          caption: '**Keyboard focus** shows them too.',
          crop: headerCrop,
          setup: async ({ page }) => {
            await parkPointer(page);
            await page.getByTestId('sessions-section-jump').focus();
            await page.keyboard.press('Tab');
          },
        },
        {
          id: 'header-filtered',
          caption: '**Filtered.** Filter stays, in blue.',
          crop: headerCrop,
          setup: async ({ page }) => {
            await page.getByTestId('sessions-filter-button').click();
            await page.getByTestId('sessions-status-filter-needs-you').click();
            await escape(page);
          },
        },
        {
          id: 'row-draft',
          caption: '**Draft.** A new session before its first message.',
          crop: 'sessions-draft-row',
          pad: 8,
          setup: async ({ page }) => {
            await page.getByTestId('sessions-filter-button').click();
            await page.getByTestId('sessions-tag-filter-clear').click();
            await escape(page);
            await page.getByTestId('sidebar-action-new-thread').click();
            await page.getByTestId('sessions-draft-row').waitFor();
            await parkPointer(page);
          },
        },
      ],
    },
    {
      board: 'Shell-SidebarStates',
      before,
      seed: list,
      states: [
        { id: 'list', caption: '**The list.** Pinned, Today, Yesterday, Earlier, then No project.', crop: PANEL },
        { id: 'list-dark', caption: '**Dark.**', crop: PANEL, theme: 'dark' },
        {
          id: 'running',
          caption: '**Show: Running.**',
          crop: PANEL,
          setup: async ({ page }) => {
            await page.getByTestId('sessions-filter-button').click();
            await page.getByTestId('sessions-status-filter-running').click();
            await escape(page);
          },
        },
        {
          id: 'needs-you',
          caption: '**Show: Needs you.**',
          crop: PANEL,
          setup: async ({ page }) => {
            await page.getByTestId('sessions-filter-button').click();
            await page.getByTestId('sessions-status-filter-needs-you').click();
            await escape(page);
          },
        },
        {
          id: 'no-match',
          caption: '**Nothing matches** the filters.',
          crop: PANEL,
          setup: async ({ page }) => {
            await page.getByTestId('sessions-filter-button').click();
            await page.getByTestId('sessions-tag-filter-urgent').click();
            await escape(page);
          },
        },
      ],
    },
    {
      board: 'Shell-SidebarStates',
      viewport: { width: 1440, height: 560 },
      before,
      seed: list,
      states: [
        {
          id: 'scrolled',
          caption: '**Scrolled.** The current group stacks under the first header, which keeps the actions.',
          crop: [57, 49, 259, 511],
          setup: async ({ page }) => page.getByTestId('sidebar-scroll').evaluate((el) => el.scrollTo({ top: 150 })),
          wait: 900,
        },
      ],
    },
    {
      board: 'Shell-SidebarMenus',
      before,
      seed: list,
      states: [
        {
          id: 'filter-open',
          caption: '**Filter.** One status, plus tags that add up. The menu stays open between picks.',
          crop: BESIDE,
          setup: async ({ page }) => page.getByTestId('sessions-filter-button').click(),
        },
        {
          id: 'filter-active',
          caption: '**Filter in use.** The button turns blue and names what it filters; “Clear filters” drops it all.',
          crop: BESIDE,
          setup: async ({ page }) => page.getByTestId('sessions-status-filter-needs-you').click(),
        },
        {
          id: 'sort-open',
          caption: '**Sort.** “Status” puts what needs you first.',
          crop: BESIDE,
          setup: async ({ page }) => {
            await page.getByTestId('sessions-tag-filter-clear').click();
            await escape(page);
            await page.getByTestId('sessions-sort-button').click();
          },
        },
        {
          id: 'more-open',
          caption: '**More.**',
          crop: BESIDE,
          setup: async ({ page }) => {
            await escape(page);
            await page.getByTestId('sessions-more-button').click();
          },
        },
        {
          id: 'context-menu',
          caption: '**Row menu.** Right-click, or the keyboard’s menu key.',
          crop: BESIDE,
          setup: async ({ page }) => {
            await escape(page);
            await row(page, 'Review the statement totals').click({ button: 'right' });
          },
        },
        {
          id: 'card-full',
          caption: '**Hover card.** Provider, project, worktree, PR and tags.',
          crop: BESIDE,
          setup: async ({ page }) => card(page, UNREAD),
        },
        {
          id: 'card-missing',
          caption: '**Worktree missing.** The warning is on the card; the row keeps its time.',
          crop: [57, 49, 663, 700],
          setup: async ({ page }) => card(page, 'Add idempotency keys to transfers'),
        },
        {
          id: 'card-fork',
          caption: '**Fork.** The parent’s name opens it.',
          crop: [57, 49, 663, 700],
          setup: async ({ page }) => card(page, FORK[0]),
        },
        {
          id: 'card-temporary',
          caption: '**Temporary, no project.**',
          crop: [57, 200, 663, 700],
          setup: async ({ page }) => card(page, 'What does CORS preflight cache?'),
        },
        {
          id: 'scope-hover',
          caption: '**Project scope, hovered.** The avatars unstack.',
          crop: [0, 49, 457, 200],
          wait: 900,
          setup: async ({ page, vars }) => {
            await escape(page);
            await page.getByTestId(`sessions-scope-avatar-${vars['atlas']}`).hover();
          },
        },
      ],
    },
    {
      board: 'Shell-SidebarViews',
      before,
      seed: list,
      states: [
        { id: 'sessions', caption: '**Chats.**', crop: PANEL },
        {
          id: 'scoped',
          caption: '**Scoped to one project.** The letter still leads.',
          crop: PANEL,
          wait: 1_200,
          setup: async ({ page, vars }) => {
            await page.getByTestId(`sessions-scope-avatar-${vars['atlas']}`).click();
            await parkPointer(page);
          },
        },
        view('tasks', '**Tasks.**'),
        view('automations', '**Automations.**'),
        view('advisor', '**Setup Advisor.**'),
        view('settings', '**Settings.**'),
      ],
    },
    {
      board: 'Shell-SidebarViews',
      before: stubUsage,
      states: [{ id: 'empty', caption: '**No project yet.**', crop: PANEL, wait: 1_000 }],
    },
    {
      board: 'Shell-SidebarErrors',
      before: stubUsage,
      seed: async (ctx) => {
        const { chats } = await seedWorkbench(ctx.page);
        ctx.vars['last'] = chats.at(-1)!;
      },
      states: [
        {
          id: 'rename',
          caption: '**Rename.** The title turns into a field on the same row; focus is the solid 2 px line (C3).',
          crop: [0, 0, 560, 560],
          setup: async ({ page, vars }) => {
            await page
              .locator(`[data-testid="sessions-row"][data-chat-id="${vars['last']}"]`)
              .click({ button: 'right' });
            await page.getByTestId('sessions-ctx-rename').click();
            await page.getByTestId('sessions-rename-input').first().focus();
            // Not parkPointer: losing focus would save the name and close the field.
            await page.mouse.move(1, 1);
          },
          wait: 1_200,
        },
        {
          id: 'tag-name-error',
          caption: '**Tag name not allowed.** The reason is muted rose (`fail`, S6).',
          crop: [0, 0, 720, 560],
          setup: async ({ page, vars }) => {
            await escape(page);
            await page
              .locator(`[data-testid="sessions-row"][data-chat-id="${vars['last']}"]`)
              .click({ button: 'right' });
            await page.getByTestId('sessions-ctx-tags').click();
            const popover = page.getByTestId('sessions-tag-popover');
            await popover.waitFor();
            await popover.locator('input').first().fill('release, urgent');
            await page.keyboard.press('Enter');
            await page.getByTestId('sessions-tag-popover-name-error').waitFor();
            await page.mouse.move(1, 1);
          },
          wait: 1_200,
        },
      ],
    },
  ],
};

export default area;
