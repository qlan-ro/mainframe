// Workspace: errors. The other Workspace-* boards are not captured by this tool yet (README).
import { fail, seedWorkbench, stubUsage } from '../seed.mts';
import type { CaptureArea } from '../types.mts';

const area: CaptureArea = {
  boards: [
    {
      file: 'Workspace-ReviewError',
      title: 'Workspace — review could not load',
      subtitle: 'The error is muted rose (`fail`, S6).',
      width: 1600,
    },
  ],
  groups: [
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
