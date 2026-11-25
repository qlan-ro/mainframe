import { test, expect } from '@playwright/test';
import { launchTauriApp, closeTauriApp } from '../fixtures/app-tauri.js';
import { daemonFetch } from '../fixtures/daemon.js';
import { createTauriProject, createTauriChat, cleanupTauriProject } from '../helpers/tauri/setup.js';

test('Sonnet effort choices follow the adapter catalog @real', async () => {
  const app = await launchTauriApp();
  let project: Awaited<ReturnType<typeof createTauriProject>> | undefined;
  try {
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
    await app.page.getByTestId('composer-model-select').click();
    const row = app.page
      .locator('[data-testid^="composer-model-select-option-"]')
      .filter({ hasText: /Sonnet/i })
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    const testId = await row.getAttribute('data-testid');
    if (!testId) throw new Error('Sonnet model row has no test id');
    const id = testId.replace('composer-model-select-option-', '');
    await row.click();
    // A click on the trigger while the menu animates out is swallowed.
    await expect(app.page.getByTestId('composer-provider-model-popover')).toHaveCount(0);
    await app.page.getByTestId('composer-model-select').click();
    await expect(app.page.getByTestId(`composer-model-${id}-tuning`)).toBeVisible();

    const response = await daemonFetch('/api/adapters');
    expect(response.ok).toBe(true);
    const body = (await response.json()) as {
      data: { id: string; models: { id: string; supportedEfforts?: string[] }[] }[];
    };
    const adapterId = process.env['E2E_MODE'] === 'mock' ? 'mock-cli' : 'claude';
    const model = body.data.find((adapter) => adapter.id === adapterId)?.models.find((entry) => entry.id === id);
    expect(model).toBeDefined();
    expect(model?.supportedEfforts?.includes('xhigh')).toBe(process.env['E2E_MODE'] !== 'mock');
    for (const effort of ['low', 'medium', 'high', 'max', 'xhigh']) {
      const option = app.page.getByTestId(`composer-model-${id}-effort-${effort}`);
      if (model?.supportedEfforts?.includes(effort)) await expect(option).toBeVisible();
      else await expect(option).toHaveCount(0);
    }
  } finally {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  }
});
