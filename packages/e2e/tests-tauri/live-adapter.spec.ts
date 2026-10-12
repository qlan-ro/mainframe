import { test, expect } from '@playwright/test';
import { launchTauriApp, closeTauriApp } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';

test.skip(process.env['MF_E2E_ALLOW_REAL_ADAPTER'] !== '1', 'This smoke test requires the real Claude adapter');

test('Claude completes a simple turn @real', async () => {
  test.setTimeout(150_000);
  const app = await launchTauriApp();
  let project: Awaited<ReturnType<typeof createTauriProject>> | undefined;
  try {
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default', 'claude');
    await sendMessage(app.page, 'Reply with exactly LIVE-ADAPTER-OK and nothing else.');
    const reply = app.page.getByTestId('chat-assistant-message').last();
    await expect(reply).toContainText(/LIVE-ADAPTER-OK|session limit/i, {
      timeout: 90_000,
    });
    await expect(reply).toContainText('LIVE-ADAPTER-OK');
    await waitForIdle(app.page, 20_000);
  } finally {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  }
});
