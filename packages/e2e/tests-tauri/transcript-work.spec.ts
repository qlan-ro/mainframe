/**
 * §transcript-work — a turn's work row end to end: the "Finished work" setting,
 * a permission request answered while the row is open and while it is folded,
 * and how a turn ended.
 *
 * Recordings: `messaging` (a Bash turn), `permissions-interactive` (a Write that
 * is asked for twice) and `turn-finished` (a Bash turn its provider completed).
 */
import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitConnected, waitForIdle } from '../helpers/tauri/wait.js';
import { waitForDialogScrimsGone } from '../helpers/tauri/menus.js';
import { openRow, toolRow, workRows } from '../helpers/tauri/transcript.js';

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

const choice = (page: Page, id: 'fold' | 'open') => page.getByTestId(`settings-appearance-finished-work-${id}`);

async function openAppearance(page: Page) {
  await waitForDialogScrimsGone(page);
  await page.getByTestId('shell-rail-settings').click();
  await expect(page.getByTestId('settings-surface')).toBeVisible();
  await page.getByTestId('settings-nav-general').click();
}

async function chooseFinishedWork(page: Page, id: 'fold' | 'open') {
  await openAppearance(page);
  await choice(page, id).click();
  await page.getByTestId('shell-rail-chats').click();
  await waitForDialogScrimsGone(page);
}

test.describe('§transcript-work — finished work', () => {
  const pageFor = recordedChat('messaging');

  test('folds by default, keeps an opened row over a change of the setting, and persists', async () => {
    const page = pageFor();
    await openAppearance(page);
    await expect(choice(page, 'fold')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('shell-rail-chats').click();

    await sendMessage(page, 'What is 2 + 2? Reply with just the number.');
    await waitForIdle(page, 60_000);
    await sendMessage(page, 'List the files in this project using bash ls.');
    await waitForIdle(page, 60_000);
    const work = workRows(page).last();
    await expect(work).toHaveAttribute('aria-expanded', 'false');
    await expect(toolRow(page, 'Bash')).toHaveCount(0);

    await chooseFinishedWork(page, 'open');
    await expect(work).toHaveAttribute('aria-expanded', 'true');
    const row = toolRow(page, 'Bash').first();
    await openRow(row);
    await expect(row.getByTestId('chat-bash-output')).toContainText('CLAUDE.md');

    await chooseFinishedWork(page, 'fold');
    await expect(row.getByTestId('chat-bash-output')).toContainText('CLAUDE.md');

    await chooseFinishedWork(page, 'open');
    await page.reload();
    await openAppearance(page);
    await expect(choice(page, 'open')).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('§transcript-work — permission requests', () => {
  const pageFor = recordedChat('permissions-interactive', 'default');

  test('a turn that waits says so, and can be answered open or folded', async () => {
    const page = pageFor();
    await sendMessage(page, 'Create a file at /tmp/mf-e2e-test.txt with content "hello"');
    await expect(page.getByTestId('chat-permission-gate')).toBeVisible({ timeout: 45_000 });
    const work = workRows(page).last();
    await expect(work).toHaveAccessibleName(/^Waiting on you/);
    await expect(work).toHaveAttribute('aria-expanded', 'true');
    await expect(toolRow(page, 'Write').last()).toContainText('needs approval');
    await page.getByTestId('chat-permission-option-reject-once').click();
    await waitForIdle(page, 60_000);

    await sendMessage(page, 'Create /tmp/mf-e2e-test.txt again');
    await expect(page.getByTestId('chat-permission-gate')).toBeVisible({ timeout: 45_000 });
    await expect(work).toHaveAccessibleName(/^Waiting on you/);
    await work.click();
    await expect(work).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('chat-permission-option-allow-once').click();
    await waitForIdle(page, 60_000);
    await expect(page.getByTestId('chat-permission-gate')).toHaveCount(0);
    // This recording says nothing of how its turns end, so neither does the row.
    await expect(work).toHaveAccessibleName(/^Worked/);
  });
});

test.describe('§transcript-work — how a turn ended', () => {
  const pageFor = recordedChat('turn-finished');

  test('a turn whose provider says it completed reads Finished, also after a reload', async () => {
    const page = pageFor();
    await sendMessage(page, 'List the files');
    await waitForIdle(page, 60_000);
    await expect(workRows(page).last()).toHaveAccessibleName(/^Finished: Worked/);
    await page.reload();
    await waitConnected(page);
    await expect(workRows(page).last()).toHaveAccessibleName(/^Finished: Worked/, { timeout: 15_000 });
  });
});
