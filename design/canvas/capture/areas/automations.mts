// Automations: errors. The other Automations-* boards are not captured by this tool yet (README).
import { fail, parkPointer, seedWorkbench, stubUsage } from '../seed.mts';
import type { CaptureArea } from '../types.mts';

const area: CaptureArea = {
  boards: [
    {
      file: 'Automations-Errors',
      title: 'Automations — errors',
      subtitle: 'Errors are muted rose (`fail`, S6).',
      width: 3072,
    },
  ],
  groups: [
    {
      board: 'Automations-Errors',
      before: stubUsage,
      seed: async ({ page }) => {
        await seedWorkbench(page);
        await page.getByTestId('shell-rail-automations').click();
      },
      states: [
        {
          id: 'editor-issues',
          caption: '**Editor, steps to fix.** Marks on the cards and the count at the bottom.',
          setup: async ({ page }) => {
            await page.getByTestId('automations-sidebar-new').click();
            await page.getByTestId('automations-editor-issues').waitFor();
            await parkPointer(page);
          },
          wait: 800,
        },
      ],
    },
    {
      board: 'Automations-Errors',
      before: async (page) => {
        await stubUsage(page);
        await fail(page, /\/api\/automations(\?|$)/, 'The daemon could not read the automations.');
      },
      seed: async ({ page }) => {
        await seedWorkbench(page);
        await page.getByTestId('shell-rail-automations').click();
      },
      states: [
        {
          id: 'list-error',
          caption: '**The list did not load.**',
          crop: [0, 0, 720, 480],
          setup: async ({ page }) => {
            await page.getByTestId('automations-sidebar-error').waitFor();
            await parkPointer(page);
          },
        },
      ],
    },
  ],
};

export default area;
