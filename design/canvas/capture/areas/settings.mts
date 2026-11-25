// Settings & dialogs: errors and field focus. The other Settings-* boards are not captured by this tool yet (README).
import { fail, parkPointer, seedWorkbench, stubUsage } from '../seed.mts';
import type { CaptureArea } from '../types.mts';

const area: CaptureArea = {
  boards: [
    {
      file: 'Settings-Chat',
      title: 'Settings — Chat',
      subtitle: 'What Enter does while a turn runs.',
      width: 2400,
    },
    {
      file: 'Settings-Errors',
      title: 'Settings — field focus and errors',
      subtitle: 'A focused field, and a setting that could not be saved.',
      width: 2400,
    },
    {
      file: 'Settings-General-Links',
      title: 'Settings — links and finished work',
      subtitle: 'Where a link in a reply opens (T1d), and whether finished work folds (T1b).',
      width: 2400,
    },
  ],
  groups: [
    {
      board: 'Settings-Chat',
      before: stubUsage,
      seed: async ({ page }) => {
        await seedWorkbench(page);
        await page.getByTestId('shell-rail-settings').click();
        await page.getByTestId('settings-nav-chat').click();
        await page.getByTestId('settings-pane-chat').waitFor();
        await parkPointer(page);
      },
      states: [
        {
          id: 'queue',
          caption: '**Queue** (the default): Enter sends when the agent finishes; ⌥↵ steers (C9).',
          crop: [0, 48, 1440, 420],
        },
        {
          id: 'steer',
          caption: '**Steer**: Enter adds the message to the running turn; ⌥↵ queues.',
          crop: [0, 48, 1440, 420],
          setup: async ({ page }) => {
            await page.getByTestId('settings-chat-enter-running-steer').click();
            await parkPointer(page);
          },
        },
      ],
    },
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
    {
      board: 'Settings-General-Links',
      before: stubUsage,
      seed: async ({ page }) => {
        await seedWorkbench(page);
        await page.getByTestId('shell-rail-settings').click();
        await page.getByTestId('settings-pane-general').waitFor();
        await parkPointer(page);
      },
      states: [
        {
          id: 'defaults',
          caption: '**Defaults.** Links open in the workspace; finished work folds.',
          crop: [317, 48, 1123, 560],
        },
        {
          id: 'browser',
          caption: '**In the browser.** Every link of a reply opens in the system’s default browser.',
          crop: [317, 48, 1123, 560],
          setup: async ({ page }) => {
            await page.getByTestId('settings-links-open-in-browser').click();
            await parkPointer(page);
          },
        },
      ],
    },
  ],
};

export default area;
