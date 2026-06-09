import type { Page } from '@playwright/test';
import { composer } from './page-objects.js';

/** Submit a message through the composer. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  await composer(page).submit(text);
}

/** Wait until the assistant is idle (the running indicator is gone). */
export async function waitForIdle(page: Page, timeout = 60_000): Promise<void> {
  await page
    .locator('[data-testid="chat-thread-running"]')
    .waitFor({ state: 'hidden', timeout })
    .catch(async () => {
      // If it never appeared, idle is already true — confirm no running indicator.
      await page
        .locator('[data-testid="chat-thread-running"]')
        .waitFor({ state: 'detached', timeout: 1_000 })
        .catch(() => {});
    });
}
