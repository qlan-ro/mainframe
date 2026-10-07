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
 * The child is a task chat: it has no sidebar row, and lives inside the
 * parent's `delegate_task` card, which expands into its live transcript.
 *
 * Testid reference:
 *   chat-tool-delegate-task-card / -trigger / -status / -open-<taskId> — the tool card
 *   chat-tool-delegate-task-transcript-<taskId> — the child's transcript inside the card
 *   sessions-row (data-chat-id) — a sidebar row; the child never gets one
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

  test('delegate → the child stays out of the sidebar → result card lands in the parent', async () => {
    const { page } = app;
    await sendMessage(page, 'Delegate a race review of the diff to a child chat');

    const card = page.getByTestId('chat-tool-delegate-task-card');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText('Race review');

    const result = page.locator('[data-testid^="chat-task-result-card-"]');
    await expect(result).toBeVisible({ timeout: 60_000 });
    await expect(result).toContainText('No data races found');
    await waitForIdle(page, 60_000);

    await expect(card.getByTestId('chat-tool-delegate-task-status')).toHaveAttribute('data-status', 'completed');
    await expect(page.getByTestId('chat-header-tasks-chip')).toHaveText(/1 task done/);
    // The child row has loaded (the card reads its status), yet the sidebar lists only the parent.
    await expect(page.getByTestId('sessions-row')).toHaveCount(1);
    await expect(page.getByTestId('sessions-row-fork-nest')).toHaveCount(0);
  });

  test("the card expands into the child's transcript", async () => {
    const { page } = app;
    const card = page.getByTestId('chat-tool-delegate-task-card');
    await card.getByTestId('chat-tool-delegate-task-trigger').click();
    const transcript = card.locator('[data-testid^="chat-tool-delegate-task-transcript-"]');
    await expect(transcript).toContainText('No data races found', { timeout: 15_000 });
  });

  test('the card opens the child, which links back to its delegator', async () => {
    const { page } = app;
    await page.locator('[data-testid^="chat-tool-delegate-task-open-"]').click();
    const parentLink = page.getByTestId('chat-header-parent-link').first();
    await expect(parentLink).toContainText('Delegated by', { timeout: 15_000 });
    await expect(page.getByTestId('sessions-row')).toHaveCount(1);

    await parentLink.click();
    await expect(page.getByTestId('chat-tool-delegate-task-card')).toBeVisible({ timeout: 15_000 });
  });
});
