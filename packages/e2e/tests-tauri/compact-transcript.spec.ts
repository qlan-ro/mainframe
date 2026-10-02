import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';
import { waitForDialogScrimsGone } from '../helpers/tauri/menus.js';

function recordedChat(recordingKey: string, permissionMode: 'default' | 'acceptEdits' = 'acceptEdits') {
  let app: TauriAppFixture;
  let project: TauriProject;
  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, permissionMode);
  });
  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });
  return () => app.page;
}
async function openAppearance(page: Page) {
  await waitForDialogScrimsGone(page);
  await page.getByTestId('sidebar-settings').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
  await page.getByTestId('settings-nav-general').click();
}
async function selectTranscript(page: Page, mode: 'compact' | 'verbose') {
  await openAppearance(page);
  await page.getByTestId(`settings-appearance-transcript-${mode}`).click();
  await page.getByTestId('settings-dialog-close').click();
  await waitForDialogScrimsGone(page);
}

test.describe('compact transcript preference and disclosure', () => {
  const pageFor = recordedChat('messaging');
  test('defaults to Verbose, persists Compact, and restores an opened row after mode changes', async () => {
    const page = pageFor();
    await openAppearance(page);
    await expect(page.getByTestId('settings-appearance-transcript-verbose')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('settings-dialog-close').click();
    await waitForDialogScrimsGone(page);
    await sendMessage(page, 'What is 2 + 2? Reply with just the number.');
    await waitForIdle(page, 60_000);
    await sendMessage(page, 'List the files in this project using bash ls.');
    await waitForIdle(page, 60_000);
    await expect(page.getByTestId('chat-bash-card').first()).toBeVisible();
    await selectTranscript(page, 'compact');
    const row = page.locator('[data-testid^="chat-compact-toggle-"]').first();
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await row.focus();
    await row.press('Enter');
    await expect(page.getByTestId('chat-bash-output').first()).toBeVisible();
    await selectTranscript(page, 'verbose');
    await expect(page.getByTestId('chat-bash-card').first()).toBeVisible();
    await selectTranscript(page, 'compact');
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await page.reload();
    await openAppearance(page);
    await expect(page.getByTestId('settings-appearance-transcript-compact')).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('compact transcript permission controls', () => {
  const pageFor = recordedChat('permissions-interactive', 'default');
  test('keeps deny and allow available when a tool row is collapsed or expanded', async () => {
    const page = pageFor();
    await selectTranscript(page, 'compact');
    await sendMessage(page, 'Create a file at /tmp/mf-e2e-test.txt with content "hello"');
    await expect(page.getByTestId('chat-permission-gate')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('button', { name: /Waiting for approval/ })).toBeVisible();
    await page.getByTestId('chat-permission-option-reject-once').click();
    await waitForIdle(page, 60_000);
    await sendMessage(page, 'Create /tmp/mf-e2e-test.txt again');
    await expect(page.getByTestId('chat-permission-gate')).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: /Waiting for approval/ }).click();
    await page.getByTestId('chat-permission-option-allow-once').click();
    await waitForIdle(page, 60_000);
    await expect(page.getByTestId('chat-permission-gate')).toHaveCount(0);
  });
});

test.describe('compact transcript subagents', () => {
  const pageFor = recordedChat('task-subagent');
  test('reveals nested compact steps directly and preserves native command output', async () => {
    const page = pageFor();
    await selectTranscript(page, 'compact');
    await sendMessage(page, 'Delegate finding the greeting export to a subagent');
    await waitForIdle(page, 60_000);
    const agent = page.getByRole('button', { name: /agent general-purpose/ }).first();
    await expect(agent).toHaveAttribute('aria-expanded', 'false');
    await agent.click();
    await expect(page.getByTestId('chat-task-toggle')).toHaveCount(0);
    const nested = page.locator('[data-testid^="chat-compact-details-"] [data-testid^="chat-compact-toggle-"]').first();
    await expect(nested).toHaveAttribute('aria-expanded', 'false');
    await nested.click();
    await expect(page.getByTestId('chat-bash-command').first()).toContainText('export const greeting');
    await expect(page.getByTestId('chat-bash-output').first()).toBeVisible();
  });
});
