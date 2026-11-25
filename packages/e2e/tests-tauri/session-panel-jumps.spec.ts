/**
 * §session-panel — where a click on an Activity row takes you in a long session.
 *
 * The windowed-history fixture loads only the newest turns, and its tool
 * results are 32 KB, with multiline output on the tall-row target. The task list is answered on the
 * network boundary: the mock adapter tracks only background work of its own.
 *
 * Testid reference:
 *   session-panel-activity-<entryId>  — an Activity row
 *   chat-message-list[data-loaded-count] — how many messages are loaded
 *   workspace-conversation-agent-<toolCallId> — a sub-agent's tab in the workspace
 *   workspace-tab-agent-<toolCallId> / workspace-tab-close-agent-<toolCallId> — its pill and close button
 *   [data-activity-id]                — a transcript row, by the tool calls it stands for
 */
import { test, expect, type Page } from '@playwright/test';
import { rmSync } from 'node:fs';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { WINDOWED_RECORDING_KEY, WINDOWED_PAGE_CONTAINERS } from '../fixtures/windowed-history.js';
import { HistoryWire, seedWindowedHistory } from '../helpers/tauri/windowed-history.js';
import { cleanupHeadlessProject } from '../helpers/tauri/headless-chat.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { waitConnected } from '../helpers/tauri/wait.js';

const DOCKED = { width: 2100, height: 900 };

/** A task started by this tool call; the fixture's calls are `window-tool-<turn>-<n>`. */
function task(id: string, kind: 'agent' | 'other', toolUseId: string) {
  return {
    id,
    kind,
    toolName: kind === 'other' ? 'Monitor' : 'Bash',
    toolUseId,
    command: id,
    description: id,
    outputPath: null,
    startedAt: Date.now() - 60_000,
    endedAt: null,
    status: 'running',
    lastOutputLine: null,
    summary: null,
    usage: null,
  };
}

const TASKS = [
  task('earlier-monitor', 'other', 'window-tool-239-1'),
  task('earlier-agent', 'agent', 'window-tool-239-2'),
  task('missing-monitor', 'other', 'window-tool-missing'),
  task('recent-monitor', 'other', 'window-tool-244-1'),
];

test.describe('§session-panel — jumps in a windowed session', () => {
  let seed: Awaited<ReturnType<typeof seedWindowedHistory>>;
  let app: TauriAppFixture;
  const wire = new HistoryWire();

  test.beforeAll(async () => {
    seed = await seedWindowedHistory();
    app = await launchTauriApp({
      dataDir: seed.dataDir,
      recordingKey: WINDOWED_RECORDING_KEY,
      recordingsDir: seed.recordingsDir,
      beforeNavigate: async (page) => {
        await wire.install(page);
        await page.route(/\/api\/chats\/[^/]+\/background-tasks$/, (route) =>
          route.fulfill({
            json: { success: true, data: { tasks: TASKS } },
            headers: { 'access-control-allow-origin': '*' },
          }),
        );
      },
    });
    await app.page.setViewportSize(DOCKED);
  });
  test.afterAll(async () => {
    wire.release();
    await closeTauriApp(app);
    if (seed) {
      cleanupHeadlessProject(seed.project);
      rmSync(seed.recordingsDir, { recursive: true, force: true });
    }
  });
  test.beforeEach(async () => {
    const { page } = app;
    wire.release();
    await page.reload();
    await waitConnected(page);
    await sessionsSidebar(page).row(seed.chatId).click();
    await expect(page.getByTestId('chat-message-list')).toHaveAttribute(
      'data-loaded-count',
      String(WINDOWED_PAGE_CONTAINERS),
    );
    await expect(page.getByText('Needle turn 249', { exact: true })).toBeInViewport();
  });

  const row = (page: Page, id: string) => page.getByTestId(`session-panel-activity-task:${id}`);
  const target = (page: Page, toolCallId: string) => page.locator(`[data-activity-id="${toolCallId}"]`);

  test('a monitor started before the loaded history loads it and lands on its own row', async () => {
    const { page } = app;
    await row(page, 'earlier-monitor').click();
    const landed = target(page, 'window-tool-239-1');
    await expect(landed).toHaveAttribute('data-activity-flash', '', { timeout: 10_000 });
    await expect(landed).toBeInViewport();
    await expect(landed.locator(':focus')).toHaveCount(1);
  });

  test('a sub-agent started before the loaded history opens its own tab', async () => {
    const { page } = app;
    await row(page, 'earlier-agent').click();
    const body = page.getByTestId('workspace-conversation-agent-window-tool-239-2');
    await expect(body).toBeVisible({ timeout: 10_000 });
    // It has a status once its call is loaded; until then it says that it is loading, or is not there.
    await expect(body.getByTestId('workspace-agent-status-window-tool-239-2')).toBeVisible({ timeout: 10_000 });
    await expect(body.getByText('Not in this transcript')).toHaveCount(0);
    await expect(page.getByTestId('chat-message-list')).not.toHaveAttribute(
      'data-loaded-count',
      String(WINDOWED_PAGE_CONTAINERS),
    );

    // Open tabs outlive a reload, and an open workspace parks the panel the other tests click in.
    await page.getByTestId('workspace-tab-agent-window-tool-239-2').hover();
    await page.getByTestId('workspace-tab-close-agent-window-tool-239-2').click();
    await expect(page.getByTestId('workspace-surface')).toHaveCount(0);
  });

  test('a monitor the history does not hold says so and stays put', async () => {
    const { page } = app;
    await row(page, 'missing-monitor').click();
    await expect(page.getByText('started before the history shown here')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-activity-flash]')).toHaveCount(0);
    await expect(page.getByText('Needle turn 249', { exact: true })).toBeInViewport();
  });

  test('a row says it is loading, and a click on another row wins over its late history', async () => {
    const { page } = app;
    wire.holdPage = true;
    await row(page, 'earlier-monitor').click();
    await expect(page.getByRole('button', { name: 'Monitor: earlier-monitor, loading' })).toBeVisible();
    await row(page, 'recent-monitor').click();
    const landed = target(page, 'window-tool-244-1');
    await expect(landed).toHaveAttribute('data-activity-flash', '', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: /, loading$/ })).toHaveCount(0);

    wire.release();
    await expect(page.getByTestId('chat-message-list')).not.toHaveAttribute(
      'data-loaded-count',
      String(WINDOWED_PAGE_CONTAINERS),
    );
    await expect(landed).not.toHaveAttribute('data-activity-flash', '', { timeout: 5_000 });
    await expect(landed).toBeInViewport();
    await expect(target(page, 'window-tool-239-1').locator('[aria-expanded="true"]')).toHaveCount(0);
    await expect(page.locator('[data-activity-flash]')).toHaveCount(0);
  });

  test('leaving the session while its history loads says nothing about it in the next one', async () => {
    const { page } = app;
    wire.holdPage = true;
    await row(page, 'earlier-monitor').click();
    await expect(page.getByRole('button', { name: 'Monitor: earlier-monitor, loading' })).toBeVisible();
    await sessionsSidebar(page).newButton().click();
    await expect(row(page, 'earlier-monitor')).toHaveCount(0);
    wire.release();
    // Nothing is expected to appear; long enough for it to have.
    await page.waitForTimeout(1_500);
    await expect(page.getByText('started before the history shown here')).toHaveCount(0);
    await expect(page.getByText('Could not load the message')).toHaveCount(0);
  });

  test('a row taller than the viewport lands on its top, with focus on it', async () => {
    const { page } = app;
    // A row's body scrolls in itself past 384px, so it takes a short window.
    await page.setViewportSize({ width: DOCKED.width, height: 400 });
    await row(page, 'recent-monitor').click();
    const landed = target(page, 'window-tool-244-1');
    await expect(landed).toHaveAttribute('data-activity-flash', '', { timeout: 10_000 });
    await expect(landed).not.toHaveAttribute('data-activity-flash', '', { timeout: 5_000 });

    const viewport = (await page.getByTestId('chat-thread-viewport').boundingBox())!;
    const box = (await landed.boundingBox())!;
    expect(box.height).toBeGreaterThan(viewport.height);
    expect(Math.abs(box.y - viewport.y)).toBeLessThan(40);
    await expect(landed.locator(':focus')).toHaveCount(1);
  });
});
