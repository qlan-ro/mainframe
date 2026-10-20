import { test, expect } from '@playwright/test';
import { armHistoryPaint, historyPaintMs, installHistoryPaintProbe } from '../helpers/tauri/history-paint.js';

test('keypress-to-paint includes synchronous keyboard handlers before the input update', async ({ page }) => {
  await installHistoryPaintProbe(page);
  await page.goto('data:text/html,<input data-testid="probe-input">');
  await page.evaluate(() => {
    window.addEventListener(
      'keydown',
      () => {
        const start = performance.now();
        while (performance.now() - start < 120) {
          /* Simulate a slow application shortcut handler. */
        }
      },
      true,
    );
  });
  await page.getByTestId('probe-input').focus();
  await armHistoryPaint(page, '[data-testid="probe-input"]', 'key');
  await page.keyboard.type('a');
  expect(await historyPaintMs(page)).toBeGreaterThanOrEqual(120);
  await expect(page.getByTestId('probe-input')).toHaveValue('a');
});
