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

  test('sending the first message locks an installed alternative while keeping the active provider selectable', async () => {
    const { page } = app;
    // Fix only alternative-provider availability; chat creation and the first turn use the real daemon.
    await page.route(ADAPTERS_URL, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.data = (body.data as ProviderAvailability[]).map((provider) =>
        provider.id === 'codex' ? { ...provider, installed: true } : provider,
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
    await expect(active).toBeEnabled();
    await expect(active).toHaveAttribute('aria-selected', 'true');
    await expect(alternative).toBeDisabled();
    await expect(page.getByTestId('composer-adapter-locked-codex')).toBeVisible();
    await expect(page.getByTestId('composer-provider-footer')).toContainText('Provider stays fixed for this session.');
    await page.keyboard.press('Escape');
  });
});
