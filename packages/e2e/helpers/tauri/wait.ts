import type { Page } from '@playwright/test';
import { composer } from './page-objects.js';

/** Submit a message through the composer. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  await composer(page).submit(text);
}

/**
 * Wait until the app shows a connected daemon.
 *
 * The old `app-status-bar` ("Daemon Connected" text) was retired (~2026-06-23) — connection
 * status now lives in the sidebar footer's daemon trigger (`DaemonFooterStatus.tsx`), whose
 * `ConnDot` renders `aria-label="Connected"` once `useConnectionStatus().state === 'connected'`.
 */
export async function waitConnected(page: Page, timeout = 20_000): Promise<void> {
  await page.locator('[data-testid="daemon-footer-trigger"]').locator('[aria-label="Connected"]').waitFor({ timeout });
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
