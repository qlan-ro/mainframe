// Workspace: the tabs in the title bar, and errors. The other Workspace-* boards are not captured by this tool yet (README).
import {
  escape,
  fail,
  openTab,
  openWorkspaceFiles,
  parkPointer,
  seedWorkbench,
  stubUsage,
  WORKSPACE_FILES,
} from '../seed.mts';
import type { CaptureArea } from '../types.mts';

const TAB_FILES = ['use-quota.ts', 'CLAUDE.md', 'quota.rs', 'UsageCapsule.tsx'];

const area: CaptureArea = {
  boards: [
    {
      file: 'Workspace-Tabs',
      title: 'Workspace — tabs in the title bar',
      subtitle: 'The title bar’s workspace segment: tabs, `+`, Files (W2, W3).',
      width: 2300,
    },
    {
      file: 'Workspace-ReviewError',
      title: 'Workspace — review could not load',
      subtitle: 'The error is muted rose (`fail`, S6).',
      width: 1600,
    },
  ],
  groups: [
    {
      board: 'Workspace-Tabs',
      before: stubUsage,
      seed: async ({ page }) => {
        const { chats } = await seedWorkbench(page, {
          ...WORKSPACE_FILES,
          '.mainframe/launch.json': JSON.stringify({
            version: '1.0',
            configurations: [
              { name: 'ui-dev', runtimeExecutable: 'sleep', runtimeArgs: ['600'] },
              { name: 'typecheck', runtimeExecutable: 'true', runtimeArgs: [] },
            ],
          }),
        });
        await openTab(page, chats.at(-1)!);
      },
      states: [
        {
          id: 'workspace-empty',
          caption: '**Nothing open.** `+` and Files stay in the title bar; the panel is the empty state.',
          crop: [780, 0, 660, 640],
          setup: async ({ page }) => {
            await page.getByTestId('surface-rail-workspace').click();
            await page.getByTestId('workspace-empty-state').waitFor();
            await parkPointer(page);
          },
        },
        {
          id: 'workspace-add-menu',
          caption: '**The `+` menu.** A file, a terminal (⌘J), a URL (⌘T) or a launch configuration.',
          crop: [780, 0, 660, 640],
          setup: async ({ page }) => {
            await page.getByTestId('workspace-tab-strip-add-empty').click();
            await page.getByTestId('workspace-add-menu-empty').waitFor();
          },
        },
        {
          id: 'workspace-tabs',
          caption: '**Four tabs.** The selected one keeps its whole title; the others shrink to 60 px.',
          crop: [780, 0, 660, 260],
          setup: async ({ page }) => {
            await escape(page);
            await openWorkspaceFiles(page, TAB_FILES);
            await parkPointer(page);
          },
        },
        {
          id: 'workspace-tab-hover',
          caption: '**Hover.** The close button lies over the end of the title, so it takes no space.',
          crop: [780, 0, 660, 120],
          setup: async ({ page }) => page.locator('[data-testid^="workspace-tab-"][role="tab"]').first().hover(),
          wait: 800,
        },
        {
          id: 'workspace-tabs-overflow',
          caption: '**Overflow.** In a narrow panel the row scrolls, and the selected tab stays in view.',
          crop: [780, 0, 660, 120],
          setup: async ({ page }) => {
            await page.locator('[data-testid^="workspace-tab-"][role="tab"]').first().click();
            const divider = (await page.getByTestId('surf-divider-x').boundingBox())!;
            await page.mouse.move(divider.x, 500);
            await page.mouse.down();
            await page.mouse.move(1010, 500, { steps: 4 });
            await page.mouse.up();
            await parkPointer(page);
          },
          wait: 800,
        },
        {
          id: 'workspace-narrow',
          caption: '**320 px panel.** A selected title longer than the row fades at its end; its close button stays.',
          crop: [780, 0, 660, 120],
          setup: async ({ page }) => {
            await page.locator('[data-testid^="workspace-tab-"][role="tab"]').last().click();
            const divider = (await page.getByTestId('surf-divider-x').boundingBox())!;
            await page.mouse.move(divider.x, 500);
            await page.mouse.down();
            await page.mouse.move(1400, 500, { steps: 4 });
            await page.mouse.up();
            await parkPointer(page);
          },
          wait: 800,
        },
        {
          id: 'workspace-files',
          caption: '**Files on.** The toggle keeps a soft fill while the tree is docked.',
          crop: [780, 0, 660, 360],
          setup: async ({ page }) => {
            const divider = (await page.getByTestId('surf-divider-x').boundingBox())!;
            await page.mouse.move(divider.x, 500);
            await page.mouse.down();
            await page.mouse.move(800, 500, { steps: 4 });
            await page.mouse.up();
            await page.getByTestId('workspace-files-open').click();
            await parkPointer(page);
          },
          wait: 800,
        },
      ],
    },
    {
      board: 'Workspace-ReviewError',
      before: async (page) => {
        await stubUsage(page);
        await fail(page, /\/git\/status(\?|$)/, 'not a git repository');
      },
      seed: async ({ page }) => {
        await seedWorkbench(page);
      },
      states: [
        {
          id: 'review-load-error',
          caption: '**Review could not read the repository.**',
          setup: async ({ page }) => {
            await page.keyboard.press('ControlOrMeta+Shift+R');
            await page.getByTestId('review-load-error').waitFor();
          },
          wait: 800,
        },
      ],
    },
  ],
};

export default area;
