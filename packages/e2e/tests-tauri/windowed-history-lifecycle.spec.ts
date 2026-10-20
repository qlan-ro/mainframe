import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { WINDOWED_RECORDING_KEY } from '../fixtures/windowed-history.js';
import { HistoryWire, seedWindowedHistory } from '../helpers/tauri/windowed-history.js';
import { cleanupHeadlessProject, createHeadlessChat } from '../helpers/tauri/headless-chat.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { waitConnected } from '../helpers/tauri/wait.js';

test.describe('windowed history lifecycle', () => {
  let seed: Awaited<ReturnType<typeof seedWindowedHistory>>;
  let app: TauriAppFixture;
  let other: string;
  const wire = new HistoryWire();

  test.beforeAll(async () => {
    seed = await seedWindowedHistory();
    app = await launchTauriApp({
      dataDir: seed.dataDir,
      recordingKey: WINDOWED_RECORDING_KEY,
      recordingsDir: seed.recordingsDir,
      beforeNavigate: async (page) => {
        other = await createHeadlessChat(seed.project.projectId);
        await wire.install(page);
      },
    });
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
    await app.page.reload();
    await waitConnected(app.page);
    await sessionsSidebar(app.page).row(seed.chatId).click();
    await expect(app.page.getByTestId('chat-user-message')).toHaveCount(20);
    await expect(app.page.getByTestId('chat-load-earlier')).toBeVisible();
  });

  test('keeps earlier pages across chat switches and a socket reconnect', async () => {
    const page = app.page;
    await page.getByTestId('chat-load-earlier').click();
    await expect(page.getByTestId('chat-user-message')).toHaveCount(40);
    await sessionsSidebar(page).row(other).click();
    await expect(page.getByTestId('chat-user-message')).toHaveCount(0);
    await sessionsSidebar(page).row(seed.chatId).click();
    await expect(page.getByTestId('chat-user-message')).toHaveCount(40);
    const completed = wire.replaysCompleted.get(seed.chatId)!;
    await wire.disconnect();
    await wire.waitForReplay(seed.chatId, completed);
    await expect(page.getByTestId('chat-user-message')).toHaveCount(40);
    await expect(page.getByText('Needle turn 210', { exact: true })).toHaveCount(1);
  });

  test('returns to the newest window after daemon resync', async () => {
    const page = app.page;
    await page.getByTestId('chat-load-earlier').click();
    await expect(page.getByTestId('chat-user-message')).toHaveCount(40);
    const completed = wire.replaysCompleted.get(seed.chatId)!;
    wire.resync(seed.chatId);
    await wire.waitForReplay(seed.chatId, completed);
    await expect(page.getByTestId('chat-user-message')).toHaveCount(20);
    await expect(page.getByText('Needle turn 249', { exact: true })).toBeVisible();
    await expect(page.getByText('Needle turn 210', { exact: true })).toHaveCount(0);
  });

  test('keeps compact disclosures on prepend and opens an unloaded find target', async () => {
    const page = app.page;
    await page.getByTestId('shell-rail-settings').click();
    await page.getByTestId('settings-nav-general').click();
    await page.getByTestId('settings-appearance-transcript-compact').click();
    await page.getByTestId('shell-rail-chats').click();
    const recent = page.locator('[data-testid^="chat-compact-toggle-"]').last();
    const testId = await recent.getAttribute('data-testid');
    expect(testId).toBeTruthy();
    await recent.click();
    await expect(page.getByTestId(testId!)).toHaveAttribute('aria-expanded', 'true');
    await page.getByTestId('chat-load-earlier').click();
    await expect(page.getByTestId('chat-user-message')).toHaveCount(40);
    await expect(page.getByTestId(testId!)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Meta+f');
    await page.getByTestId('thread-find-input').fill('Tool summary 2/0');
    await expect(page.getByTestId('find-bar')).toContainText('1/1');
    await page.getByTestId('thread-find-next').click();
    await expect(page.getByText('Tool summary 2/0', { exact: true })).toBeVisible();
    await expect(page.getByTestId(testId!)).toHaveAttribute('aria-expanded', 'true');
  });

  test('Activity loads one earlier page without losing the bottom pin', async () => {
    const page = app.page;
    const toggle = page.getByTestId('session-panel-toggle');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    const load = page.getByTestId('session-panel-load-earlier');
    await expect(load).toBeVisible();
    const viewport = page.getByTestId('chat-thread-viewport');
    const bottomDistance = () => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
    await expect.poll(bottomDistance).toBeLessThan(2);
    const before = wire.pageRequests;
    await load.click();
    await expect(page.getByTestId('chat-user-message')).toHaveCount(40);
    expect(wire.pageRequests).toBe(before + 1);
    await expect.poll(bottomDistance).toBeLessThan(2);
    await expect(load).toBeEnabled();
  });
});
