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

/**
 * Wait until the assistant is idle (the running indicator is gone) and its text has settled.
 *
 * A turn's final text keeps smooth-streaming for a moment after the run stops: the markdown
 * container (`.aui-md`) carries `data-status="running"` until the reveal catches up. A test
 * that reads or selects that text before then races the reveal's DOM updates.
 */
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
  await waitForTextSettled(page, timeout);
}

/** Wait until no assistant message is still revealing streamed text. */
export async function waitForTextSettled(page: Page, timeout = 10_000): Promise<void> {
  await page
    .locator('[data-testid="chat-assistant-message"] .aui-md[data-status="running"]')
    .first()
    .waitFor({ state: 'detached', timeout });
}
