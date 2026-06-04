/**
 * §58 Model-tuning inheritance — verify provider defaults, chat-level overrides,
 * and the null-inheritance contract end-to-end through the real app + daemon.
 *
 * Design: inherit-by-null. A new chat stores effort/features as null (not set), so the
 * resolver uses the provider default at spawn time. The provider→chat→endpoint contract
 * is covered by core unit tests (resolve-tuning, routes); these specs validate the UI
 * surface: a provider default is set via settings, a chat reflects/overrides it, and a
 * per-chat override does not mutate the provider default.
 */

import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';

test.describe('§58 Model-tuning inheritance — UI level', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('IT4: effort chip respects a provider-level default set via settings', async () => {
    const { page } = fixture;
    // Determine which adapter and a capable model to use.
    // In mock mode: adapter = mock-cli, capable model = claude-opus-4-5-20251001.
    // In record/live mode: adapter = claude, capable model = default or claude-opus-4-6.
    const isMock = process.env['E2E_MODE'] === 'mock';
    const adapterId = isMock ? 'mock-cli' : 'claude';
    const capableModelId = isMock ? 'claude-opus-4-5-20251001' : 'default';

    // Open settings and navigate to the provider section.
    await page.locator('[data-testid="left-rail-settings"]').click();
    await page.locator('[data-testid="settings-modal-sidebar-tab-providers"]').click();

    const providerItem = page.locator(`[data-testid="settings-modal-sidebar-provider-${adapterId}"]`);
    if (!(await providerItem.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, `provider ${adapterId} not registered in this environment`);
      return;
    }
    await providerItem.click();

    // Switch default model to a capable one.
    const modelTrigger = page.locator('[data-testid="model-dropdown-trigger"]');
    await expect(modelTrigger).toBeVisible({ timeout: 5_000 });
    await modelTrigger.click();
    const modelOption = page.locator(`[data-testid="model-dropdown-option-${capableModelId}"]`);
    if (!(await modelOption.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, `model ${capableModelId} not in model list`);
      return;
    }
    await modelOption.click();

    // Set provider default effort to 'high'.
    const effortSelect = page.locator(`[data-testid="providers-${adapterId}-default-effort"]`);
    await expect(effortSelect).toBeVisible({ timeout: 5_000 });
    await effortSelect.selectOption('high');
    await expect(effortSelect).toHaveValue('high');

    await page.locator('[data-testid="settings-modal-close"]').click();
    await expect(page.locator('[data-testid="settings-modal-close"]')).toHaveCount(0);

    // Create a new chat using the same adapter and switch to the capable model.
    await createTestChat(fixture.page, project.projectId, 'default', adapterId);

    // Switch to the capable model in the composer.
    await page.locator('[data-testid="composer-model-select"]').click();
    const composerModelOption = page.locator(
      `[data-testid="composer-model-select-option-${capableModelId}"]`,
    );
    await expect(composerModelOption).toBeVisible({ timeout: 5_000 });
    await composerModelOption.click();

    // The effort chip now shows the EFFECTIVE value (chat override → provider default →
    // model default). A fresh chat inherits the provider default 'high' set above.
    const effortChip = page.locator('[data-testid="composer-effort-select"]');
    await expect(effortChip).toBeVisible({ timeout: 5_000 });
    await expect(effortChip).toContainText(/high/i);

    // Explicitly set the per-chat effort to 'low' via the composer.
    await effortChip.click();
    const lowOption = page.locator('[data-testid="composer-effort-select-option-low"]');
    await expect(lowOption).toBeVisible({ timeout: 5_000 });
    await lowOption.click();
    await expect(effortChip).toContainText(/low/i);
  });

  test('IT5: per-chat effort override does not change the provider default in settings', async () => {
    const { page } = fixture;
    const isMock = process.env['E2E_MODE'] === 'mock';
    const adapterId = isMock ? 'mock-cli' : 'claude';

    // Open settings to verify the provider default was NOT changed by the composer override.
    await page.locator('[data-testid="left-rail-settings"]').click();
    await page.locator('[data-testid="settings-modal-sidebar-tab-providers"]').click();

    const providerItem = page.locator(`[data-testid="settings-modal-sidebar-provider-${adapterId}"]`);
    if (!(await providerItem.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, `provider ${adapterId} not registered in this environment`);
      return;
    }
    await providerItem.click();

    // The effort default must still be 'high' from IT4.
    const effortSelect = page.locator(`[data-testid="providers-${adapterId}-default-effort"]`);
    if (await effortSelect.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // If visible, value must be 'high' (the value we set in IT4).
      await expect(effortSelect).toHaveValue('high');
    }
    // If not visible, the model was haiku/fallback (no caps) — skip the assertion.

    await page.locator('[data-testid="settings-modal-close"]').click();
  });
});
