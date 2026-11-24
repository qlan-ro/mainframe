// Session panel: errors. The other Chat-SessionPanel-* boards are not captured by this tool yet (README).
import { fail, seedWorkbench, stubUsage } from '../seed.mts';
import type { CaptureArea } from '../types.mts';

const area: CaptureArea = {
  boards: [
    {
      file: 'Chat-SessionPanel-ActivityError',
      title: 'Chat — session panel: Activity could not load',
      subtitle: 'The error label is muted rose (`fail`, S6).',
      width: 1000,
    },
  ],
  groups: [
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
          crop: [1140, 48, 300, 560],
        },
      ],
    },
  ],
};

export default area;
