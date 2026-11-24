// Tasks: errors and field focus. The other Tasks-* boards are not captured by this tool yet (README).
import { escape, fail, parkPointer, seedWorkbench, stubUsage } from '../seed.mts';
import type { CaptureArea } from '../types.mts';

const area: CaptureArea = {
  boards: [
    {
      file: 'Tasks-Errors',
      title: 'Tasks — field focus and errors',
      subtitle: 'The label field’s focus line, and a repository that could not be read.',
      width: 3072,
    },
  ],
  groups: [
    {
      board: 'Tasks-Errors',
      before: async (page) => {
        await stubUsage(page);
        await fail(page, /remotes/, 'Could not read the project’s git remotes.');
      },
      seed: async (ctx) => {
        const { atlas } = await seedWorkbench(ctx.page);
        await ctx.page.getByTestId(`sessions-scope-avatar-${atlas}`).click({ modifiers: ['Alt'] });
        await ctx.page.getByTestId('shell-rail-tasks').click();
        await ctx.page.getByTestId('tasks-board').waitFor();
      },
      states: [
        {
          id: 'label-focus',
          caption: '**New task, labels focused.** The whole field carries the focus line (C3).',
          setup: async ({ page }) => {
            await page.getByTestId('tasks-sidebar-new').click();
            await page.getByTestId('tasks-edit-title').fill('Fix the login redirect');
            await page.getByTestId('tasks-label-input').click();
          },
          wait: 800,
        },
        {
          id: 'remotes-error',
          caption: '**Remotes not readable.** The reason is muted rose (`fail`, S6).',
          setup: async ({ page }) => {
            await escape(page);
            await page.getByTestId('tasks-github-link').click();
            await page.getByTestId('tasks-github-link-dialog').waitFor();
            await parkPointer(page);
          },
          wait: 800,
        },
      ],
    },
  ],
};

export default area;
