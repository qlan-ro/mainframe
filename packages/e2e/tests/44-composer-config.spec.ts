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

  test('M6: effort select appears for an effort-capable model and updates', async () => {
    const { page } = fixture;
    // Effort only renders for Claude models with supportsEffort (Sonnet 4.x / Opus 4.x), so switch
    // to one first (the test daemon defaults to Haiku, which lacks it).
    await page.locator('[data-testid="composer-model-select"]').click();
    // Probed model ids are CLI aliases (sonnet/opus/haiku/default), not full version strings.
    const effortModel = page
      .locator('[data-testid="composer-model-select-option-sonnet"], [data-testid="composer-model-select-option-opus"]')
      .first();
    if (!(await effortModel.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'no effort-capable model probed in this environment');
      return;
    }
    await effortModel.click();

    const effort = page.locator('[data-testid="composer-effort-select"]');
    await expect(effort).toBeVisible({ timeout: 5_000 });
    await effort.click();
    await page.locator('[data-testid="composer-effort-select-option-high"]').click();
    await expect(effort).toContainText(/high/i);
  });
});
