import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';

// New coverage from scenarios/composer.md (M4, M5, M6, M7). No AI — config selects only.
test.describe('§44 Composer config selects', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'default');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('M5: model select opens, lists models, and closes on pick', async () => {
    const { page } = fixture;
    await page.locator('[data-testid="composer-model-select"]').click();
    const options = page.locator('[data-testid^="composer-model-select-option-"]');
    await expect(options.first()).toBeVisible({ timeout: 5_000 });
    const count = await options.count();
    await options.nth(count - 1).click();
    await expect(options.first()).toHaveCount(0); // dropdown closed after pick
  });

  test('M7: permission-mode select switches to Unattended (yolo)', async () => {
    const { page } = fixture;
    const trigger = page.locator('[data-testid="composer-permission-mode-select"]');
    await trigger.click();
    await page.locator('[data-testid="composer-permission-mode-select-option-yolo"]').click();
    await expect(trigger).toContainText(/unattended/i, { timeout: 5_000 });
    // Reset to Interactive for cleanliness
    await trigger.click();
    await page.locator('[data-testid="composer-permission-mode-select-option-default"]').click();
  });

  test('M4: adapter select is present and enabled before the first message', async () => {
    const { page } = fixture;
    const adapter = page.locator('[data-testid="composer-adapter-select"]');
    await expect(adapter).toBeVisible();
    await expect(adapter).toBeEnabled();
    await adapter.click();
    await expect(page.locator('[data-testid^="composer-adapter-select-option-"]').first()).toBeVisible({
      timeout: 5_000,
    });
    // Close without switching (avoid selecting an unconfigured adapter).
    await page.keyboard.press('Escape');
  });

  test('M6: effort select (Claude models that support it)', async () => {
    const { page } = fixture;
    const effort = page.locator('[data-testid="composer-effort-select"]');
    // Effort only renders for Claude models with supportsEffort — skip if the default model lacks it.
    if (!(await effort.isVisible().catch(() => false))) {
      test.skip(true, 'active model does not support effort');
      return;
    }
    await effort.click();
    await expect(page.locator('[data-testid="composer-effort-select-option-high"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="composer-effort-select-option-high"]').click();
    await expect(effort).toContainText(/high/i);
  });
});
