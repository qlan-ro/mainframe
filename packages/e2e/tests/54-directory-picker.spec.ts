import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';

// New coverage from scenarios/files-editor-review.md (F11 directory picker dismissal). No AI.
test.describe('§54 Directory picker', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
  });
  test.afterAll(async () => {
    await closeApp(fixture);
  });

  test('opens from add-project and dismisses via close, cancel, and Esc', async () => {
    const { page } = fixture;
    const modal = page.locator('[data-testid="dir-picker-modal"]');
    const open = () => page.locator('[data-testid="chats-add-project"]').click();

    // Close (X)
    await open();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="directory-picker-close"]').click();
    await expect(modal).toHaveCount(0);

    // Cancel button
    await open();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="directory-picker-cancel"]').click();
    await expect(modal).toHaveCount(0);

    // Escape
    await open();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
  });
});
