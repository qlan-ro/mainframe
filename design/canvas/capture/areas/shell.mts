// Shell & title bar: Shell-Window, Shell-States, Shell-TitleBar. Shell-Flow is interactive (README, Known limits).
import { sendMessage, waitForIdle } from '../../../../packages/e2e/helpers/tauri/wait.js';
import { escape, openTab, parkPointer, reload, renameChat, seedProject, seedWorkbench, stubUsage } from '../seed.mts';
import type { CaptureArea, CaptureContext, CaptureState } from '../types.mts';

async function workbench(ctx: CaptureContext): Promise<void> {
  const { page } = ctx;
  const { chats } = await seedWorkbench(page);
  for (const id of chats.slice(3)) await openTab(page, id);
  await sendMessage(page, 'Find where greeting is defined and used');
  await waitForIdle(page);
  const last = chats.at(-1)!;
  await renameChat(page, last, 'Where is greeting defined?');
  ctx.vars['last'] = last;
  ctx.vars['previous'] = chats.at(-2)!;
  await parkPointer(page);
}

const PAGE_TITLES: Record<string, string> = {
  chats: 'Chats',
  tasks: 'Tasks',
  automations: 'Automations',
  advisor: 'Setup Advisor',
  settings: 'Settings',
};

function railState(view: string): CaptureState {
  return {
    id: `rail-${view}`,
    caption: `**${PAGE_TITLES[view]}** selected.`,
    crop: 'shell-rail',
    setup: async ({ page }) => {
      await page.getByTestId(`shell-rail-${view}`).click();
      await parkPointer(page);
    },
  };
}

function hover(id: string, caption: string, testId: string, crop: CaptureState['crop']): CaptureState {
  return {
    id,
    caption,
    crop,
    wait: 1_200,
    setup: async ({ page }) => {
      await parkPointer(page);
      await page.getByTestId(testId).hover();
    },
  };
}

const area: CaptureArea = {
  boards: [
    { file: 'Shell-Window', title: 'Shell — populated window', width: 1440, bare: true },
    {
      file: 'Shell-States',
      title: 'Shell — window states',
      subtitle: 'First run, the tour, a lost daemon and the collapsed sidebar.',
      width: 4512,
    },
    {
      file: 'Shell-TitleBar',
      title: 'Shell — title bar and navigation',
      subtitle: 'Usage capsule, session tabs, the nav rail and what opens from them.',
      width: 3100,
    },
  ],
  groups: [
    {
      board: 'Shell-Window',
      launch: { recordingKey: 'tool-group' },
      before: stubUsage,
      seed: workbench,
      states: [{ id: 'window-populated' }],
    },
    {
      board: 'Shell-States',
      launch: { suppressTour: false },
      before: stubUsage,
      states: [
        {
          id: 'first-run',
          caption: '**First run.** No project yet: the hero offers one, and the sidebar is empty.',
          wait: 1_000,
        },
        {
          id: 'tour-1',
          caption: '**The tour** opens by itself once there is a project and no session.',
          setup: async ({ page }) => {
            await seedProject('atlas-web');
            await reload(page);
            await page.getByTestId('tour-overlay').waitFor();
          },
          wait: 1_000,
        },
        {
          id: 'tour-2',
          caption: '**Tour, second step.** The spotlight moves; a secondary ring marks the other way in.',
          setup: async ({ page }) => page.getByTestId('tour-next-btn').click(),
          wait: 1_000,
        },
      ],
    },
    {
      board: 'Shell-States',
      launch: { recordingKey: 'tool-group' },
      before: stubUsage,
      seed: workbench,
      states: [
        {
          id: 'sidebar-collapsed',
          caption: '**Sidebar collapsed** to the rail (⌘B).',
          setup: async ({ page }) => page.keyboard.press('ControlOrMeta+b'),
          wait: 800,
        },
        {
          id: 'reconnecting',
          caption: '**Daemon lost.** The overlay stays until the daemon answers again.',
          setup: async ({ page }) => {
            await page.keyboard.press('ControlOrMeta+b');
            await page.route('**/health', (route) => route.abort());
            await page.getByTestId('connection-overlay').waitFor();
          },
          wait: 800,
        },
      ],
    },
    {
      board: 'Shell-TitleBar',
      launch: { recordingKey: 'tool-group' },
      before: stubUsage,
      seed: workbench,
      states: [
        { id: 'title-bar', caption: '**Title bar.** Usage capsule, session tabs, search, actions.', crop: 'title-bar' },
        hover('tab-hover', '**Tab hover.** The tooltip carries the full title.', 'session-tabs', [0, 0, 1440, 96]),
        {
          id: 'usage-open',
          caption: '**Usage open.** Hover shows every limit at once; a click pins it.',
          crop: [0, 0, 720, 420],
          setup: async ({ page }) => {
            await page.getByTestId('usage-capsule').click();
            await page.getByTestId('usage-capsule-popover').waitFor();
          },
        },
        {
          id: 'capsule-focus',
          caption: '**Keyboard focus (C3).** One solid 2 px line in focus blue, no halo.',
          crop: [0, 0, 720, 48],
          setup: async ({ page }) => {
            await escape(page);
            await page.getByTestId('usage-capsule').focus();
            await page.keyboard.press('Shift+Tab');
            await page.keyboard.press('Tab');
          },
        },
        {
          id: 'tab-menu',
          caption: '**Tab menu.** Right-click a session tab.',
          crop: [300, 0, 720, 420],
          setup: async ({ page, vars }) => {
            await page.getByTestId(`session-tab-${vars['last']}`).click({ button: 'right' });
            await page.getByTestId('session-tab-ctx-close').waitFor();
          },
        },
        {
          id: 'daemon-menu',
          caption: '**Daemon switcher.** The rail shows which machine the window talks to.',
          crop: [0, 480, 520, 420],
          setup: async ({ page }) => {
            await escape(page);
            await page.getByTestId('shell-rail-daemon').click();
            await page.getByTestId('daemon-picker').waitFor();
          },
        },
        {
          ...hover('rail-hover', '**Rail hover.** A tooltip names the view.', 'shell-rail-tasks', [0, 48, 240, 320]),
          setup: async ({ page }) => {
            await escape(page);
            await page.getByTestId('shell-rail-tasks').hover();
          },
        },
        railState('tasks'),
        railState('automations'),
        railState('advisor'),
        railState('settings'),
        railState('chats'),
        {
          id: 'split-pair',
          caption: '**Split.** Two sessions side by side share one fused tab.',
          setup: async ({ page, vars }) => {
            await escape(page);
            await page.getByTestId(`session-tab-${vars['previous']}`).click({ button: 'right' });
            await page.getByTestId('session-tab-ctx-open-split').click();
            await parkPointer(page);
          },
          wait: 900,
        },
      ],
    },
  ],
};

export default area;
