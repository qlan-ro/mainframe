import { test, expect } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { DAEMON_PORT } from '../fixtures/daemon.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { sendMessage, waitConnected, waitForIdle } from '../helpers/tauri/wait.js';

const ADAPTERS_URL = `http://127.0.0.1:${DAEMON_PORT}/api/adapters`;
const ACTIVE_PROVIDER = process.env['E2E_MODE'] === 'mock' ? 'mock-cli' : 'claude';

interface ProviderAvailability {
  id: string;
  installed: boolean;
  models: { id: string; label: string }[];
}

test.describe('§composer provider availability and session lock', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let chatId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging' });
    project = await createTauriProject(app.page);
    chatId = await createTauriChat(app.page, project.projectId, 'default', ACTIVE_PROVIDER);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('M4: installed providers are selectable before the first message; unavailable providers are disabled', async () => {
    const { page } = app;
    const response = await page.request.get(ADAPTERS_URL);
    expect(response.ok()).toBe(true);
    const { data: providers } = (await response.json()) as { data: ProviderAvailability[] };
    expect(providers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ACTIVE_PROVIDER, installed: true })]),
    );

    await page.getByTestId('composer-model-select').click();
    await expect(page.locator('[data-testid^="composer-adapter-select-option-"]')).toHaveCount(providers.length);
    for (const provider of providers) {
      expect(typeof provider.installed).toBe('boolean');
      const tab = page.getByTestId(`composer-adapter-select-option-${provider.id}`);
      await expect(tab).toBeVisible();
      await expect(tab).toBeEnabled({ enabled: provider.installed });
    }
    await expect(page.getByTestId(`composer-adapter-select-option-${ACTIVE_PROVIDER}`)).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('composer-provider-footer')).toContainText(
      'Pick a provider before your first message.',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('composer-provider-model-popover')).toHaveCount(0);
  });

  test('sending the first message leaves an installed alternative browsable, not locked (provider-switch-in-place)', async () => {
    const { page } = app;
    // Fix only alternative-provider availability; chat creation and the first turn use the real daemon.
    // Codex isn't actually installed in this sandbox (empty fallback catalog), so a fake model is
    // injected too — just enough for the browsing UI to render a pickable row.
    await page.route(ADAPTERS_URL, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.data = (body.data as ProviderAvailability[]).map((provider) =>
        provider.id === 'codex'
          ? { ...provider, installed: true, models: [{ id: 'fake-codex-model', label: 'Fake Codex Model' }] }
          : provider,
      );
      await route.fulfill({ response, json: body });
    });
    await page.reload();
    await waitConnected(page);
    await sessionsSidebar(page).row(chatId).click();

    const active = page.getByTestId(`composer-adapter-select-option-${ACTIVE_PROVIDER}`);
    const alternative = page.getByTestId('composer-adapter-select-option-codex');
    await page.getByTestId('composer-model-select').click();
    await expect(active).toBeEnabled();
    await expect(alternative).toBeEnabled();
    await expect(alternative).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByTestId('composer-adapter-locked-codex')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('composer-provider-model-popover')).toHaveCount(0);

    await sendMessage(page, 'List the files in this project using bash ls.');
    await waitForIdle(page, 90_000);
    await page.getByTestId('composer-model-select').click();

    // Per docs/specs/2026-10-06-provider-switch-in-place.md: after the first
    // message, a tab click no longer switches the chat directly — it only
    // browses that provider's catalog. The old copy and the
    // `composer-adapter-locked-<id>` wrapper are gone; the alternative tab
    // stays enabled, and picking one of its models asks to switch in place.
    await expect(active).toBeEnabled();
    await expect(active).toHaveAttribute('aria-selected', 'true');
    await expect(alternative).toBeEnabled();
    await expect(page.getByTestId('composer-adapter-locked-codex')).toHaveCount(0);
    await expect(page.getByTestId('composer-provider-footer')).toContainText(
      'Switching keeps this chat. The new provider gets its history with your next message.',
    );

    // Browsing the alternative's catalog only changes which catalog the menu
    // shows (the tab's own selected state) — it does not touch the chat's
    // active provider.
    await alternative.click();
    await expect(page.getByText('Codex models')).toBeVisible();
    await expect(alternative).toHaveAttribute('aria-selected', 'true');

    // Picking one of its models opens the switch confirmation rather than
    // switching outright; cancelling leaves the chat on its original provider
    // (codex is only faked as "installed" client-side here, so confirming
    // would hit the daemon's real not-installed refusal — out of scope for
    // this UI-level test).
    const confirmDialog = page.getByTestId('composer-provider-switch-confirm');
    await page.getByTestId('composer-model-select-option-fake-codex-model').click();
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText('Continue this chat in Codex?');
    await expect(page.getByTestId('composer-provider-model-popover')).toHaveCount(0);
    await page.getByTestId('composer-provider-switch-confirm-cancel').click();
    await expect(confirmDialog).toBeHidden();

    // Reopening the menu shows the active provider selected again — cancelling
    // never switched anything.
    await page.getByTestId('composer-model-select').click();
    await expect(page.getByTestId(`composer-adapter-select-option-${ACTIVE_PROVIDER}`)).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.keyboard.press('Escape');
  });
});
