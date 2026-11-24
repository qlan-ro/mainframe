// Sidebar: errors and focus. The other Shell-Sidebar* boards are not captured by this tool yet (README).
import { escape, seedWorkbench, stubUsage } from '../seed.mts';
import type { CaptureArea } from '../types.mts';

const area: CaptureArea = {
  boards: [
    {
      file: 'Shell-SidebarErrors',
      title: 'Shell — sidebar: editing and errors',
      subtitle: 'Renaming a session in place, and a tag name that is not allowed.',
      width: 1500,
    },
  ],
  groups: [
    {
      board: 'Shell-SidebarErrors',
      before: stubUsage,
      seed: async (ctx) => {
        const { chats } = await seedWorkbench(ctx.page);
        ctx.vars['last'] = chats.at(-1)!;
      },
      states: [
        {
          id: 'rename',
          caption: '**Rename.** The title turns into a field on the same row; focus is the solid 2 px line (C3).',
          crop: [0, 0, 560, 560],
          setup: async ({ page, vars }) => {
            await page
              .locator(`[data-testid="sessions-row"][data-chat-id="${vars['last']}"]`)
              .click({ button: 'right' });
            await page.getByTestId('sessions-ctx-rename').click();
            await page.getByTestId('sessions-rename-input').first().focus();
            // Not parkPointer: losing focus would save the name and close the field.
            await page.mouse.move(1, 1);
          },
          wait: 1_200,
        },
        {
          id: 'tag-name-error',
          caption: '**Tag name not allowed.** The reason is muted rose (`fail`, S6).',
          crop: [0, 0, 720, 560],
          setup: async ({ page, vars }) => {
            await escape(page);
            await page
              .locator(`[data-testid="sessions-row"][data-chat-id="${vars['last']}"]`)
              .click({ button: 'right' });
            await page.getByTestId('sessions-ctx-tags').click();
            const popover = page.getByTestId('sessions-tag-popover');
            await popover.waitFor();
            await popover.locator('input').first().fill('release, urgent');
            await page.keyboard.press('Enter');
            await page.getByTestId('sessions-tag-popover-name-error').waitFor();
            await page.mouse.move(1, 1);
          },
          wait: 1_200,
        },
      ],
    },
  ],
};

export default area;
