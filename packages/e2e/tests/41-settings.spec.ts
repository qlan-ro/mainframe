import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';

// New coverage from scenarios/settings-remote-chrome.md (SE1–SE3). No AI.
// (The settings modal root has no testid — settings-modal-close is the stable anchor.)
test.describe('§41 Settings modal', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
  });
  test.afterAll(async () => {
    await closeApp(fixture);
  });

  test('SE1/SE2: opens from the left rail and closes via button and Escape', async () => {
    const { page } = fixture;
    await page.locator('[data-testid="left-rail-settings"]').click();
    await expect(page.locator('[data-testid="settings-modal-close"]')).toBeVisible({ timeout: 5_000 });
    // sidebar tabs are present
    await expect(page.locator('[data-testid="settings-modal-sidebar-tab-general"]')).toBeVisible();

    await page.locator('[data-testid="settings-modal-close"]').click();
    await expect(page.locator('[data-testid="settings-modal-close"]')).toHaveCount(0);

    // Re-open and close via Escape
    await page.locator('[data-testid="left-rail-settings"]').click();
    await expect(page.locator('[data-testid="settings-modal-close"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="settings-modal-close"]')).toHaveCount(0);
  });

  test('SE3: worktree-dir save button appears only when the field is dirty', async () => {
    const { page } = fixture;
    await page.locator('[data-testid="left-rail-settings"]').click();
    await page.locator('[data-testid="settings-modal-sidebar-tab-general"]').click();

    const input = page.locator('[data-testid="general-worktree-dir-input"]');
    await expect(input).toBeVisible({ timeout: 5_000 });
    const original = (await input.inputValue()) ?? '';
    const save = page.locator('[data-testid="general-worktree-dir-save"]');
    // Save is hidden until the value changes
    await expect(save).toHaveCount(0);

    // Editing makes it dirty → save appears
    await input.fill(`${original}/mf-e2e-edit`);
    await expect(save).toBeVisible();

    // Reverting to the original clears the dirty state → save disappears
    await input.fill(original);
    await expect(save).toHaveCount(0);

    await page.locator('[data-testid="settings-modal-close"]').click();
  });
});
