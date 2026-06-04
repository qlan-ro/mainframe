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

  test('M6: effort select shows dynamic levels for a capable model', async () => {
    const { page } = fixture;
    // Switch to a model that has supportedEfforts. In mock mode the mock-cli exposes
    // claude-opus-4-5-20251001 (xhigh+max) and claude-sonnet-4-5-20251101 (no xhigh).
    // In record/live mode we look for a sonnet or opus option. Skip gracefully if absent.
    await page.locator('[data-testid="composer-model-select"]').click();
    const opusOption = page.locator(
      '[data-testid="composer-model-select-option-claude-opus-4-5-20251001"],' +
        '[data-testid="composer-model-select-option-opus"]',
    );
    const sonnetOption = page.locator(
      '[data-testid="composer-model-select-option-claude-sonnet-4-5-20251101"],' +
        '[data-testid="composer-model-select-option-sonnet"]',
    );
    const effortModel = (await opusOption.isVisible({ timeout: 5_000 }).catch(() => false))
      ? opusOption
      : sonnetOption;
    if (!(await effortModel.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'no effort-capable model found in this environment');
      return;
    }
    await effortModel.click();

    const effort = page.locator('[data-testid="composer-effort-select"]');
    await expect(effort).toBeVisible({ timeout: 5_000 });

    // The dropdown must list the model's declared levels.
    await effort.click();
    await expect(page.locator('[data-testid="composer-effort-select-option-low"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="composer-effort-select-option-high"]')).toBeVisible();

    // Pick high and confirm the chip reflects it.
    await page.locator('[data-testid="composer-effort-select-option-high"]').click();
    await expect(effort).toContainText(/high/i);
  });

  test('M6b: effort select for opus-level model includes xhigh and max options', async () => {
    const { page } = fixture;
    // Switch to opus-level mock model that declares xhigh+max.
    await page.locator('[data-testid="composer-model-select"]').click();
    const opusOption = page.locator(
      '[data-testid="composer-model-select-option-claude-opus-4-5-20251001"],' +
        '[data-testid="composer-model-select-option-opus"]',
    );
    if (!(await opusOption.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'no opus-level model found in this environment');
      return;
    }
    await opusOption.click();

    const effort = page.locator('[data-testid="composer-effort-select"]');
    await expect(effort).toBeVisible({ timeout: 5_000 });
    await effort.click();
    // xhigh and max are only on opus-level models.
    await expect(page.locator('[data-testid="composer-effort-select-option-xhigh"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="composer-effort-select-option-max"]')).toBeVisible();
    // Close without picking.
    await page.keyboard.press('Escape');
  });

  test('M6c: haiku model hides the effort select and features trigger', async () => {
    const { page } = fixture;
    // Switch back to Haiku which has no capability fields.
    await page.locator('[data-testid="composer-model-select"]').click();
    const haikuOption = page.locator(
      '[data-testid="composer-model-select-option-claude-haiku-4-5-20251001"],' +
        '[data-testid="composer-model-select-option-haiku"]',
    );
    if (!(await haikuOption.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'haiku model not found in this environment');
      return;
    }
    await haikuOption.click();
    // Effort select must NOT render for Haiku.
    await expect(page.locator('[data-testid="composer-effort-select"]')).toHaveCount(0);
    // Features trigger must NOT render for Haiku.
    await expect(page.locator('[data-testid="composer-features-trigger"]')).toHaveCount(0);
  });

  test('M6d: features popover appears for a capable model and toggles work', async () => {
    const { page } = fixture;
    // Switch to opus-level model (has fast, ultracode, adaptiveThinking).
    await page.locator('[data-testid="composer-model-select"]').click();
    const opusOption = page.locator(
      '[data-testid="composer-model-select-option-claude-opus-4-5-20251001"],' +
        '[data-testid="composer-model-select-option-opus"]',
    );
    if (!(await opusOption.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'no opus-level model found in this environment');
      return;
    }
    await opusOption.click();

    // The features trigger button must be present.
    const trigger = page.locator('[data-testid="composer-features-trigger"]');
    await expect(trigger).toBeVisible({ timeout: 5_000 });

    // Open the popover.
    await trigger.click();

    // All three features should appear for an opus-level model.
    await expect(page.locator('[data-testid="composer-feature-fast"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="composer-feature-ultracode"]')).toBeVisible();
    await expect(page.locator('[data-testid="composer-feature-adaptiveThinking"]')).toBeVisible();
  });

  test('M6e: enabling ultracode locks the effort chip to xhigh', async () => {
    const { page } = fixture;
    // Ensure opus-level model is selected.
    await page.locator('[data-testid="composer-model-select"]').click();
    const opusOption = page.locator(
      '[data-testid="composer-model-select-option-claude-opus-4-5-20251001"],' +
        '[data-testid="composer-model-select-option-opus"]',
    );
    if (!(await opusOption.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'no opus-level model found in this environment');
      return;
    }
    await opusOption.click();

    // Open features popover.
    const trigger = page.locator('[data-testid="composer-features-trigger"]');
    await expect(trigger).toBeVisible({ timeout: 5_000 });
    await trigger.click();

    const ultracodeToggle = page.locator('[data-testid="composer-feature-ultracode"]');
    await expect(ultracodeToggle).toBeVisible({ timeout: 5_000 });

    // Turn ultracode ON (toggle to checked state).
    const initialChecked = await ultracodeToggle.getAttribute('aria-checked');
    if (initialChecked !== 'true') {
      await ultracodeToggle.click();
    }

    // Close popover by clicking outside.
    await page.keyboard.press('Escape');
    // (Close via clicking the trigger again if still open — popover is outside-click-aware.)
    if (await page.locator('[data-testid="composer-feature-ultracode"]').isVisible().catch(() => false)) {
      await trigger.click();
    }

    // The effort chip must now show "Extra-high" and be disabled (locked by ultracode).
    const effort = page.locator('[data-testid="composer-effort-select"]');
    await expect(effort).toBeVisible({ timeout: 5_000 });
    await expect(effort).toContainText(/extra-high|xhigh/i);
    await expect(effort).toBeDisabled();
  });

  test('M5b: sonnet-level model shows effort but NOT xhigh option', async () => {
    const { page } = fixture;
    await page.locator('[data-testid="composer-model-select"]').click();
    const sonnetOption = page.locator(
      '[data-testid="composer-model-select-option-claude-sonnet-4-5-20251101"],' +
        '[data-testid="composer-model-select-option-sonnet"]',
    );
    if (!(await sonnetOption.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'no sonnet-level model found in this environment');
      return;
    }
    await sonnetOption.click();

    const effort = page.locator('[data-testid="composer-effort-select"]');
    await expect(effort).toBeVisible({ timeout: 5_000 });
    await effort.click();
    // max is present for sonnet.
    await expect(page.locator('[data-testid="composer-effort-select-option-max"]')).toBeVisible({ timeout: 5_000 });
    // xhigh is absent for sonnet (no supportsUltracode).
    await expect(page.locator('[data-testid="composer-effort-select-option-xhigh"]')).toHaveCount(0);
    // Features trigger must NOT render for sonnet (only supportsFast, but ultracode/adaptive absent —
    // visibleFeatures returns fast which is truthy → trigger IS present for sonnet with supportsFast).
    // We only assert it's absent for haiku (no features) — handled in M6c.
    await page.keyboard.press('Escape');
  });
});
