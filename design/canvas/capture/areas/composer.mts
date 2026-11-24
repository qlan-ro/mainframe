// Composer & gates: focus and errors. The other Chat-Composer* boards are not captured by this tool yet (README).
import { escape, seedWorkbench, stubUsage } from '../seed.mts';
import { sendMessage } from '../../../../packages/e2e/helpers/tauri/wait.js';
import type { CaptureArea } from '../types.mts';

const area: CaptureArea = {
  boards: [
    {
      file: 'Chat-ComposerFocus',
      title: 'Chat — composer focus and gates',
      subtitle: 'The focused composer, and a permission gate above it.',
      width: 1900,
    },
  ],
  groups: [
    {
      board: 'Chat-ComposerFocus',
      launch: { recordingKey: 'permissions-no-suggestions' },
      before: stubUsage,
      seed: async (ctx) => {
        await seedWorkbench(ctx.page);
      },
      states: [
        {
          id: 'focused',
          caption: '**Focused.** The card’s hairline becomes the solid 2 px focus line (C3).',
          crop: [317, 620, 824, 280],
          setup: async ({ page }) => {
            await page.getByTestId('chat-composer-input').click();
            await page.keyboard.type('Add a test for the greeting');
          },
        },
        {
          id: 'gate',
          caption:
            '**Permission gate.** The amber halo means it waits for the user; the composer below keeps its own focus line.',
          crop: [317, 380, 824, 520],
          setup: async ({ page }) => {
            await page.getByTestId('chat-composer-input').fill('');
            await escape(page);
            await sendMessage(page, 'Write /tmp/mf-e2e-nosuggest.txt');
            await page.getByTestId('chat-permission-gate').waitFor();
          },
          wait: 800,
        },
      ],
    },
  ],
};

export default area;
