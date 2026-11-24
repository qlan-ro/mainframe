// Transcript: the window while a session delegates (no tasks chip in the header, S4), and failed work. The other Chat-* boards are not captured by this tool yet (README).
import { sendMessage, waitForIdle } from '../../../../packages/e2e/helpers/tauri/wait.js';
import { createTauriChat } from '../../../../packages/e2e/helpers/tauri/setup.js';
import { parkPointer, renameChat, seedWorkbench, stubUsage } from '../seed.mts';
import type { CaptureArea } from '../types.mts';

const area: CaptureArea = {
  boards: [
    { file: 'Chat-Window', title: 'Chat — populated window', width: 1440, bare: true },
    {
      file: 'Chat-States-Failures',
      title: 'Chat — failed work',
      subtitle: 'Failed tools are muted rose (`fail`, S6). Red stays inside terminal text.',
      width: 1900,
    },
  ],
  groups: [
    {
      board: 'Chat-Window',
      launch: { recordingKey: 'mcp-delegate' },
      before: stubUsage,
      seed: async ({ page }) => {
        const { atlas } = await seedWorkbench(page);
        const parent = await createTauriChat(page, atlas, 'acceptEdits');
        await sendMessage(page, 'Delegate a race review of the diff to a child chat');
        await page.locator('[data-testid^="chat-task-result-card-"]').waitFor({ timeout: 60_000 });
        await waitForIdle(page, 60_000);
        await renameChat(page, parent, 'Race review of the diff');
        await parkPointer(page);
      },
      states: [{ id: 'chat-window' }],
    },
    {
      board: 'Chat-States-Failures',
      launch: { recordingKey: 'bash-exit-code' },
      before: stubUsage,
      seed: async ({ page }) => {
        await seedWorkbench(page);
        await sendMessage(page, 'Run the test suite, then run a bad command');
        await waitForIdle(page);
        await parkPointer(page);
      },
      states: [
        {
          id: 'failed-tool',
          caption: '**A failed tool.** The second command failed: rose dot on the card.',
          crop: [317, 48, 824, 852],
        },
        {
          id: 'failed-tool-open',
          caption: '**Opened.** Rose outline on the card; the exit line keeps the terminal’s own red.',
          crop: [317, 48, 824, 852],
          setup: async ({ page }) => {
            await page.getByTestId('chat-bash-card').nth(1).getByTestId('chat-bash-trigger').click();
            await parkPointer(page);
          },
        },
      ],
    },
  ],
};

export default area;
