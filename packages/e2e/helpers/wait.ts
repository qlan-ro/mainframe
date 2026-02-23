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
 * Automatically approves plan and permission cards so tests that trigger
 * file-editing tasks don't stall waiting for manual approval.
 */
export async function chat(page: Page, text: string, timeout = 60_000): Promise<void> {
  await sendMessage(page, text);
  await waitForIdleHandlingInterrupts(page, timeout);
}

/**
 * Waits for the AI to become idle, auto-approving plan approval cards and
 * permission cards along the way.
 *
 * Only used by chat(). Tests that explicitly verify plan/permission UI behaviour
 * should use sendMessage() + waitForPlanCard() / waitForPermissionCard() directly.
 */
async function waitForIdleHandlingInterrupts(page: Page, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;

  // Catch fast responses — the working state may appear and disappear quickly
  await page
    .locator('[data-testid="chat-status-working"]')
    .waitFor({ timeout: 5_000 })
    .catch(() => {});

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    // Race: AI finishes, plan approval card appears, or permission card appears
    const result = await Promise.race([
      page
        .locator('[data-testid="chat-status-working"]')
        .waitFor({ state: 'hidden', timeout: remaining })
        .then(() => 'idle' as const),
      page
        .locator('[data-testid="plan-approval-card"]')
        .waitFor({ timeout: remaining })
        .then(() => 'plan' as const),
      page
        .locator('[data-testid="permission-card"]')
        .waitFor({ timeout: remaining })
        .then(() => 'permission' as const),
    ]).catch(() => 'timeout' as const);

    if (result === 'idle') return;
    if (result === 'timeout') break;

    if (result === 'plan') {
      await page.locator('[data-testid="plan-approval-card"]').getByRole('button', { name: 'Approve Plan' }).click();
    } else {
      // Auto-allow file/tool permission so file-editing tests don't stall
      await page.locator('[data-testid="permission-card"]').getByRole('button', { name: /allow/i }).first().click();
    }

    // Wait for the working indicator to return before checking again.
    // Claude may briefly go non-working between plan approval and resuming.
    await page
      .locator('[data-testid="chat-status-working"]')
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
  }

  throw new Error(`chat() timed out after ${timeout}ms waiting for AI to become idle`);
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
