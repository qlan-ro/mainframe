import { test, expect } from '@playwright/test';
import { launchApp, closeApp, DAEMON_PORT } from '../fixtures/app.js';

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

  test('SE-TUNING-1: claude provider section shows effort and feature defaults for a capable model', async () => {
    const { page } = fixture;
    // Open settings and navigate to Providers → Claude.
    await page.locator('[data-testid="left-rail-settings"]').click();
    await page.locator('[data-testid="settings-modal-sidebar-tab-providers"]').click();

    const claudeItem = page.locator('[data-testid="settings-modal-sidebar-provider-claude"]');
    if (!(await claudeItem.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'claude adapter not registered in this environment');
      return;
    }
    await claudeItem.click();

    // The default model set in launchApp() is haiku (no caps). Switch to a capable model
    // via the model-dropdown so ProviderTuningDefaults renders.
    const modelTrigger = page.locator('[data-testid="model-dropdown-trigger"]');
    await expect(modelTrigger).toBeVisible({ timeout: 5_000 });
    await modelTrigger.click();

    // Pick the 'default' model (Opus 4.7) which has full capabilities.
    const defaultOption = page.locator('[data-testid="model-dropdown-option-default"]');
    await expect(defaultOption).toBeVisible({ timeout: 5_000 });
    await defaultOption.click();

    // Now the tuning defaults for a capable model must be visible.
    await expect(page.locator('[data-testid="providers-claude-default-effort"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="providers-claude-default-feature-fast"]')).toBeVisible();
    await expect(page.locator('[data-testid="providers-claude-default-feature-ultracode"]')).toBeVisible();
    await expect(page.locator('[data-testid="providers-claude-default-feature-adaptiveThinking"]')).toBeVisible();

    await page.locator('[data-testid="settings-modal-close"]').click();
  });

  test('SE-TUNING-2: claude provider effort default change persists after reopen', async () => {
    const { page } = fixture;

    // First open — set capable model and change effort default to 'high'.
    await page.locator('[data-testid="left-rail-settings"]').click();
    await page.locator('[data-testid="settings-modal-sidebar-tab-providers"]').click();

    const claudeItem = page.locator('[data-testid="settings-modal-sidebar-provider-claude"]');
    if (!(await claudeItem.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'claude adapter not registered in this environment');
      return;
    }
    await claudeItem.click();

    // Switch to capable model.
    const modelTrigger = page.locator('[data-testid="model-dropdown-trigger"]');
    await expect(modelTrigger).toBeVisible({ timeout: 5_000 });
    await modelTrigger.click();
    await page.locator('[data-testid="model-dropdown-option-default"]').click();

    // Change the effort default to 'high'.
    const effortSelect = page.locator('[data-testid="providers-claude-default-effort"]');
    await expect(effortSelect).toBeVisible({ timeout: 5_000 });
    await effortSelect.selectOption('high');
    await expect(effortSelect).toHaveValue('high');

    // Close settings.
    await page.locator('[data-testid="settings-modal-close"]').click();
    await expect(page.locator('[data-testid="settings-modal-close"]')).toHaveCount(0);

    // Re-open and verify the effort default is still 'high'.
    await page.locator('[data-testid="left-rail-settings"]').click();
    await page.locator('[data-testid="settings-modal-sidebar-tab-providers"]').click();
    await page.locator('[data-testid="settings-modal-sidebar-provider-claude"]').click();

    // The model and effort default should be persisted.
    const effortSelectReopened = page.locator('[data-testid="providers-claude-default-effort"]');
    await expect(effortSelectReopened).toBeVisible({ timeout: 5_000 });
    await expect(effortSelectReopened).toHaveValue('high');

    await page.locator('[data-testid="settings-modal-close"]').click();
  });

  test('SE-TUNING-3: codex provider section shows personality and reasoning-summary', async () => {
    const { page } = fixture;
    await page.locator('[data-testid="left-rail-settings"]').click();
    await page.locator('[data-testid="settings-modal-sidebar-tab-providers"]').click();

    const codexItem = page.locator('[data-testid="settings-modal-sidebar-provider-codex"]');
    if (!(await codexItem.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'codex adapter not registered in this environment');
      return;
    }
    await codexItem.click();

    // CodexTuningDefaults always renders reasoning-summary; personality only when
    // the default model has supportsPersonality. We assert reasoning-summary is present
    // (always present for codex section) and that verbosity is absent.
    await expect(page.locator('[data-testid="providers-codex-reasoning-summary"]')).toBeVisible({ timeout: 5_000 });
    // No verbosity control — the field does not exist in CodexTuningDefaults.
    await expect(page.locator('[data-testid="providers-codex-verbosity"]')).toHaveCount(0);

    await page.locator('[data-testid="settings-modal-close"]').click();
  });
});

// Provider settings persistence via REST — no Electron/UI needed.
test.describe('§41 Provider settings REST persistence', () => {
  test('SE-TUNING-REST: PUT /api/settings/providers/claude round-trips defaultEffort', async () => {
    // Verify that the REST endpoint that the UI calls persists tuning settings.
    const base = `http://127.0.0.1:${DAEMON_PORT}`;

    // Set defaultEffort to 'low' via the provider settings endpoint.
    const putRes = await fetch(`${base}/api/settings/providers/claude`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultEffort: 'low', defaultFast: 'true' }),
    });
    expect(putRes.ok).toBe(true);

    // Read it back.
    const getRes = await fetch(`${base}/api/settings/providers/claude`);
    expect(getRes.ok).toBe(true);
    const body = (await getRes.json()) as { data?: { defaultEffort?: string; defaultFast?: string } };
    expect(body.data?.defaultEffort).toBe('low');
    expect(body.data?.defaultFast).toBe('true');

    // Clean up — remove the defaults.
    await fetch(`${base}/api/settings/providers/claude`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultEffort: undefined, defaultFast: undefined }),
    });
  });
});
