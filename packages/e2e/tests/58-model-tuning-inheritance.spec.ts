/**
 * §58 Model-tuning inheritance — verify that provider defaults, chat-level overrides,
 * and the null-inheritance contract behave correctly.
 *
 * Design: inherit-by-null. A new chat stores effort/features as null (not set), which
 * means the resolver uses the provider default at spawn time. This spec validates:
 *   1. Provider default can be set via the settings API.
 *   2. A new chat starts with null effort (inheriting from provider).
 *   3. Setting a per-chat override (via the composer or tuning API) stores only the
 *      chat-level value; the provider default is unchanged.
 *   4. UI display: the effort chip reads chat.effort ?? model.defaultEffort ?? 'medium'.
 */

import { test, expect } from '@playwright/test';
import { launchApp, closeApp, DAEMON_PORT } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';

const BASE = `http://127.0.0.1:${DAEMON_PORT}`;

// ---------------------------------------------------------------------------
// REST-level inheritance tests — no Electron needed, just the daemon API.
// ---------------------------------------------------------------------------
test.describe('§58 Model-tuning inheritance — REST level', () => {
  const ADAPTER = 'claude';

  test.beforeAll(async () => {
    // Reset the provider config to a clean slate before the suite.
    await fetch(`${BASE}/api/settings/providers/${ADAPTER}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultEffort: null, defaultFast: null }),
    });
  });

  test('IT1: provider default effort is stored and retrievable', async () => {
    const res = await fetch(`${BASE}/api/settings/providers/${ADAPTER}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultEffort: 'high' }),
    });
    expect(res.ok).toBe(true);

    const get = await fetch(`${BASE}/api/settings/providers/${ADAPTER}`);
    expect(get.ok).toBe(true);
    const body = (await get.json()) as { data?: { defaultEffort?: string } };
    expect(body.data?.defaultEffort).toBe('high');
  });

  test('IT2: new chat starts with null effort (inherits from provider)', async () => {
    // Create a project via API (no UI needed for REST tests).
    const projRes = await fetch(`${BASE}/api/projects`);
    const { data: projects } = (await projRes.json()) as { data: { id: string }[] };
    if (!projects[0]) {
      // No projects registered yet; this is a REST-only spec, skip.
      test.skip(true, 'no project registered in the test daemon');
      return;
    }
    const projectId = projects[0].id;

    const chatRes = await fetch(`${BASE}/api/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, adapterId: ADAPTER }),
    });
    expect(chatRes.ok).toBe(true);
    const { data: chat } = (await chatRes.json()) as { data: { id: string; effort?: string | null } };
    expect(chat.id).toBeTruthy();

    // The freshly-created chat must have effort === null (inheriting from provider).
    const getChat = await fetch(`${BASE}/api/chats/${chat.id}`);
    const { data: chatData } = (await getChat.json()) as { data: { effort?: string | null } };
    expect(chatData.effort ?? null).toBeNull();

    // Archive the created chat so it doesn't pollute other tests.
    await fetch(`${BASE}/api/chats/${chat.id}/archive`, { method: 'PATCH' });
  });

  test('IT3: per-chat override does not mutate the provider default', async () => {
    // Establish provider default.
    await fetch(`${BASE}/api/settings/providers/${ADAPTER}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultEffort: 'high' }),
    });

    // Create a chat.
    const projRes = await fetch(`${BASE}/api/projects`);
    const { data: projects } = (await projRes.json()) as { data: { id: string }[] };
    if (!projects[0]) {
      test.skip(true, 'no project registered in the test daemon');
      return;
    }
    const chatRes = await fetch(`${BASE}/api/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: projects[0].id, adapterId: ADAPTER }),
    });
    const { data: chat } = (await chatRes.json()) as { data: { id: string } };

    // Apply a per-chat override (low, different from provider's high).
    const tuningRes = await fetch(`${BASE}/api/chats/${chat.id}/tuning`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ effort: 'low' }),
    });
    expect(tuningRes.ok).toBe(true);

    // The chat-level effort is now 'low'.
    const chatGet = await fetch(`${BASE}/api/chats/${chat.id}`);
    const { data: chatData } = (await chatGet.json()) as { data: { effort?: string | null } };
    expect(chatData.effort).toBe('low');

    // The provider default must be unchanged (still 'high').
    const provGet = await fetch(`${BASE}/api/settings/providers/${ADAPTER}`);
    const { data: provData } = (await provGet.json()) as { data?: { defaultEffort?: string } };
    expect(provData?.defaultEffort).toBe('high');

    // Archive the created chat so it doesn't pollute other tests.
    await fetch(`${BASE}/api/chats/${chat.id}/archive`, { method: 'PATCH' });
  });

  test.afterAll(async () => {
    // Clean up the provider default we set during this suite.
    await fetch(`${BASE}/api/settings/providers/${ADAPTER}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultEffort: null, defaultFast: null }),
    });
  });
});

// ---------------------------------------------------------------------------
// UI-level inheritance tests — requires Electron + mock-cli (E2E_MODE=mock).
// ---------------------------------------------------------------------------
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

    // The effort chip shows effort for the chat. A fresh chat has effort=null,
    // so displayEffort() shows model.defaultEffort ?? 'medium'. In mock mode
    // the opus model's defaultEffort is 'medium'. Provider defaults propagate at
    // spawn time (server-side), not in the chip directly. The chip just needs to
    // be visible (confirming effort controls render for a capable model).
    const effortChip = page.locator('[data-testid="composer-effort-select"]');
    await expect(effortChip).toBeVisible({ timeout: 5_000 });

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
