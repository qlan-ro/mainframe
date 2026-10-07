/**
 * §mcp-delegate — an agent delegates a task over the orchestration MCP server
 * (docs/specs/2026-10-06-mcp-orchestration-server.md, test plan "E2E").
 *
 * Runs in E2E_MODE=mock. The parent's recording (`mcp-delegate.0`) carries an
 * `mcp_call` step: the mock CLI makes a real `tools/call delegate_task` to the
 * daemon's `/mcp` endpoint with its spawn credential. The daemon creates the
 * child chat, which replays `mcp-delegate.1`; when the child goes idle the
 * daemon holds its result until the parent is idle, then delivers it as the
 * parent's second turn.
 *
 * Testid reference:
 *   chat-tool-delegate-task-card / -status / -open-<taskId> — the tool card
 *   sessions-row-fork-nest / sessions-row-delegated-nest-glyph — the nested child row
 *   sessions-row-task-label     — the child row's `Task · <role>`
 *   chat-task-result-card-<taskId> — the delivered result in the parent
 *   chat-header-tasks-chip / chat-header-task-row-<taskId> — the parent's tasks chip
 *   chat-header-parent-link     — the child's "Delegated by" link
 */

import { test, expect } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';

test.describe('§mcp-delegate (mock CLI calls the real /mcp endpoint)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'mcp-delegate' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('delegate → child row nests under the parent → result card lands in the parent', async () => {
    const { page } = app;
    await sendMessage(page, 'Delegate a race review of the diff to a child chat');

    const card = page.getByTestId('chat-tool-delegate-task-card');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText('Race review');

    const nest = page.getByTestId('sessions-row-fork-nest');
    await expect(nest).toBeVisible({ timeout: 30_000 });
    await expect(nest.getByTestId('sessions-row-delegated-nest-glyph')).toBeVisible();
    await expect(nest.getByTestId('sessions-row-task-label')).toHaveText('Task · review');

    const result = page.locator('[data-testid^="chat-task-result-card-"]');
    await expect(result).toBeVisible({ timeout: 60_000 });
    await expect(result).toContainText('No data races found');
    await waitForIdle(page, 60_000);

    await expect(card.getByTestId('chat-tool-delegate-task-status')).toHaveAttribute('data-status', 'completed');
    await expect(page.getByTestId('chat-header-tasks-chip')).toHaveText(/1 task done/);
  });

  test('the card opens the child, which names its delegator', async () => {
    const { page } = app;
    await page.locator('[data-testid^="chat-tool-delegate-task-open-"]').click();
    await expect(page.getByTestId('chat-header-parent-link').first()).toContainText('Delegated by', {
      timeout: 15_000,
    });
  });
});
