// Settings & dialogs: errors and field focus. The other Settings-* boards are not captured by this tool yet (README).
import { fail, parkPointer, seedWorkbench, stubUsage } from '../seed.mts';
import type { CaptureArea } from '../types.mts';

const area: CaptureArea = {
  boards: [
    {
      file: 'Settings-Errors',
      title: 'Settings — field focus and errors',
      subtitle: 'A focused field, and a setting that could not be saved.',
      width: 2400,
    },
  ],
  groups: [
    {
      board: 'Settings-Errors',
      before: async (page) => {
        await stubUsage(page);
        await fail(page, /\/api\/settings\/general$/, 'The daemon could not write its settings.', 'PUT');
      },
      seed: async ({ page }) => {
        await seedWorkbench(page);
        await page.getByTestId('shell-rail-settings').click();
        await page.getByTestId('settings-pane-general').waitFor();
      },
      states: [
        {
          id: 'field-focus',
          caption: '**Field focus (C3).** The line sits on the field’s own edge, solid, with no halo.',
          crop: [317, 48, 1123, 560],
          setup: async ({ page }) => {
            await page.getByTestId('settings-worktree-dir-input').fill('.agent-worktrees');
          },
        },
        {
          id: 'save-error',
          caption: '**Not saved.** The reason is muted rose (`fail`, S6).',
          crop: [317, 48, 1123, 560],
          setup: async ({ page }) => {
            await page.getByTestId('settings-worktree-dir-save').click();
            await page.getByText('could not write').waitFor();
            await parkPointer(page);
          },
        },
      ],
    },
  ],
};

export default area;
