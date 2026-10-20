import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { WINDOWED_RECORDING_KEY } from '../fixtures/windowed-history.js';
import { seedWindowedHistory, HistoryWire } from '../helpers/tauri/windowed-history.js';
import { cleanupHeadlessProject } from '../helpers/tauri/headless-chat.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';
import { waitConnected } from '../helpers/tauri/wait.js';

test.describe('windowed transcript history', () => {
  let seeded: Awaited<ReturnType<typeof seedWindowedHistory>>;
  let app: TauriAppFixture;
  const wire = new HistoryWire();
  test.beforeAll(async () => {
    seeded = await seedWindowedHistory();
    app = await launchTauriApp({
      recordingKey: WINDOWED_RECORDING_KEY,
      recordingsDir: seeded.recordingsDir,
      dataDir: seeded.dataDir,
    });
    await wire.install(app.page);
  });
  test.afterAll(async () => {
    wire.release();
    await closeTauriApp(app);
    if (seeded) {
      cleanupHeadlessProject(seeded.project);
      rmSync(seeded.recordingsDir, { recursive: true, force: true });
    }
  });
  test.beforeEach(async () => {
    wire.release();
    wire.pageRequests = 0;
    wire.resumeBytes = 0;
    await app.page.reload();
    await waitConnected(app.page);
    await sessionsSidebar(app.page).row(seeded.chatId).click();
    await expect(app.page.getByTestId('chat-load-earlier')).toBeVisible();
    await expect(app.page.getByTestId('chat-thread-loading')).toHaveCount(0);
  });

  test('opens the newest window and keeps the full transcript off the wire', async () => {
    const page = app.page;
    await expect(page.getByTestId('chat-user-message')).toHaveCount(20);
    await expect(page.getByText('Needle turn 249', { exact: true })).toBeVisible();
    await expect(page.getByText('Needle turn 2 ancient landmark', { exact: true })).toHaveCount(0);
    expect(wire.pageRequests).toBe(0);
    expect(wire.resumeBytes).toBeLessThan(3_000_000);
  });

  test('holds the reading position on prepend with native anchoring disabled and never chains pages', async () => {
    const page = app.page;
    wire.holdPage = true;
    const viewport = page.getByTestId('chat-thread-viewport');
    await expect(viewport).toHaveCSS('overflow-anchor', 'none');
    await viewport.focus();
    await page.keyboard.press('Home');
    await expect.poll(() => wire.pageRequests).toBe(1);
    const anchor = await viewport.locator('[data-message-id]').evaluateAll((messages) => {
      const viewport = messages[0]!.closest('[data-mf-chat-thread]')!;
      const top = viewport.getBoundingClientRect().top;
      const node = messages.find((message) => message.getBoundingClientRect().bottom > top)! as HTMLElement;
      return { id: node.dataset.messageId!, top: node.getBoundingClientRect().top };
    });
    wire.release();
    await expect(page.getByTestId('chat-user-message')).toHaveCount(40);
    const after = await viewport
      .locator(`[data-message-id="${anchor.id}"]`)
      .evaluate((node) => node.getBoundingClientRect().top);
    expect(Math.abs(after - anchor.top)).toBeLessThan(2);
    expect(wire.pageRequests).toBe(1);
  });

  test('find counts the whole chat, loads through on step, and excludes tool output', async () => {
    const page = app.page;
    await page.keyboard.press('ControlOrMeta+f');
    await page.getByTestId('thread-find-input').fill('ancient landmark');
    await expect(page.getByTestId('find-bar')).toContainText('1/1');
    expect(wire.pageRequests).toBe(0);
    await page.getByTestId('thread-find-next').click();
    await expect(page.getByText('Needle turn 2 ancient landmark', { exact: true })).toBeVisible();
    expect(wire.pageRequests).toBe(1);
    await page.getByTestId('thread-find-input').fill('Needle turn');
    await expect(page.getByTestId('find-bar')).toContainText('/250');
    await page.getByTestId('thread-find-input').fill('hidden-output-token');
    await expect(page.getByTestId('find-bar')).toContainText('0/0');
  });

  test('keeps the anchor stable from the explicit page click through the loading state', async () => {
    const page = app.page;
    const viewport = page.getByTestId('chat-thread-viewport');
    await viewport.evaluate((node) => {
      node.scrollTop = 0;
    });
    const anchor = viewport.locator('[data-message-id]').first();
    const before = await anchor.boundingBox();
    expect(before).not.toBeNull();
    const id = await anchor.getAttribute('data-message-id');
    wire.holdPage = true;
    await page.getByTestId('chat-load-earlier').click();
    await expect.poll(() => wire.pageRequests).toBe(1);
    const loading = await page.locator(`[data-message-id="${id}"]`).boundingBox();
    expect(Math.abs(loading!.y - before!.y)).toBeLessThan(2);
    wire.release();
    await expect(page.getByTestId('chat-user-message')).toHaveCount(40);
    const after = await page.locator(`[data-message-id="${id}"]`).boundingBox();
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
    expect(wire.pageRequests).toBe(1);
  });
});
