import type { Page } from '@playwright/test';

/**
 * Waits for the AI to start working, then finish.
 * Uses the chat status dot as the signal.
 */
export async function waitForAIIdle(page: Page, timeout = 60_000): Promise<void> {
  // Catch fast responses — the working state may appear and disappear quickly
  await page
    .locator('[data-testid="chat-status-working"]')
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  await page.locator('[data-testid="chat-status-working"]').waitFor({ state: 'hidden', timeout });
}

/**
 * Types a message in the composer and presses Enter.
 */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const composer = page.getByRole('textbox');
  await composer.click();
  await composer.fill(text);
  await page.keyboard.press('Enter');
}

/**
 * Sends a message and waits for the AI to finish responding.
 */
export async function chat(page: Page, text: string, timeout = 60_000): Promise<void> {
  await sendMessage(page, text);
  await waitForAIIdle(page, timeout);
}

export async function waitForPermissionCard(page: Page, timeout = 15_000): Promise<void> {
  await page.locator('[data-testid="permission-card"]').waitFor({ timeout });
}

export async function waitForPlanCard(page: Page, timeout = 30_000): Promise<void> {
  await page.locator('[data-testid="plan-approval-card"]').waitFor({ timeout });
}

export async function waitForAskQuestionCard(page: Page, timeout = 30_000): Promise<void> {
  await page.locator('[data-testid="ask-question-card"]').waitFor({ timeout });
}

/**
 * Waits for a tool card with a matching label to appear in the thread.
 * e.g. waitForToolCard(page, 'Bash')
 */
export async function waitForToolCard(page: Page, toolLabel: string, timeout = 30_000): Promise<void> {
  await page.locator(`[data-testid="tool-card"]`, { hasText: toolLabel }).waitFor({ timeout });
}
