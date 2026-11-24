// Foundations: the app-wide scrollbar and focus line, in the running app. Foundations-Tokens is generated from
// DESIGN.md instead (design/canvas/foundations/build.py).
import { parkPointer, reload, seedWorkbench, stubUsage } from '../seed.mts';
import type { CaptureArea, Crop } from '../types.mts';

const PANE: Crop = [317, 48, 883, 552];

const area: CaptureArea = {
  boards: [
    {
      file: 'Foundations-Behaviour',
      title: 'Foundations — scrollbars and focus',
      subtitle:
        'Overlay thumbs only, no track and no gutter (S3); a solid 2 px focus line, no halo (C3). `lib/overlay-scrollbars`, `focus-line`.',
      width: 2000,
    },
  ],
  groups: [
    {
      board: 'Foundations-Behaviour',
      viewport: { width: 1200, height: 600 },
      before: stubUsage,
      seed: async ({ page }) => {
        await seedWorkbench(page);
        await reload(page);
        await page.getByTestId('shell-rail-settings').click();
        await page.getByTestId('settings-pane-general').waitFor();
      },
      states: [
        {
          id: 'scroll-rest',
          caption: '**At rest.** Nothing is drawn and the content keeps its full width.',
          crop: PANE,
          setup: async ({ page }) => parkPointer(page),
          wait: 1_500,
        },
        {
          id: 'scroll-hover',
          caption: '**Area hovered or scrolling.** A 6 px thumb, ink at 26 %, 2 px from the edge.',
          crop: PANE,
          setup: async ({ page }) => {
            await page.mouse.move(700, 300);
            await page.mouse.wheel(0, 160);
          },
        },
        {
          id: 'scroll-thumb-hover',
          caption: '**Thumb under the pointer.** 8 px, ink at 42 %. It can be dragged; it fades about a second later.',
          crop: PANE,
          setup: async ({ page }) => {
            const box = await page.locator('.mf-scrollbar[data-axis="y"]').boundingBox();
            if (!box) throw new Error('no scrollbar thumb to hover');
            await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
          },
        },
        {
          id: 'focus-field',
          caption: '**Field focus.** The line sits on the field’s own edge (`focus-line-inset`).',
          crop: PANE,
          setup: async ({ page }) => {
            await parkPointer(page);
            const field = page.getByTestId('settings-worktree-dir-input');
            await field.fill('.agent-worktrees');
            await field.focus();
          },
          wait: 1_500,
        },
        {
          id: 'focus-button',
          caption: '**Control focus.** The line stands 2 px off the control (`focus-line`).',
          crop: PANE,
          setup: async ({ page }) => page.keyboard.press('Tab'),
          wait: 800,
        },
      ],
    },
  ],
};

export default area;
