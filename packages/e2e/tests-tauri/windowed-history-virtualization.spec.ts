import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { WINDOWED_RECORDING_KEY } from '../fixtures/windowed-history.js';
import { HistoryWire, seedWindowedHistory } from '../helpers/tauri/windowed-history.js';
import { cleanupHeadlessProject } from '../helpers/tauri/headless-chat.js';
import { sessionsSidebar } from '../helpers/tauri/page-objects.js';

test.describe('virtual transcript rows', () => {
  let seed: Awaited<ReturnType<typeof seedWindowedHistory>>;
  let app: TauriAppFixture;
  const wire = new HistoryWire();
  test.beforeAll(async () => {
    seed = await seedWindowedHistory();
    app = await launchTauriApp({
      dataDir: seed.dataDir,
      recordingKey: WINDOWED_RECORDING_KEY,
      recordingsDir: seed.recordingsDir,
      beforeNavigate: (page) => wire.install(page),
    });
  });
  test.afterAll(async () => {
    await closeTauriApp(app);
    if (seed) {
      cleanupHeadlessProject(seed.project);
      rmSync(seed.recordingsDir, { recursive: true, force: true });
    }
  });
  test.beforeEach(async () => {
    await app.page.reload();
    await sessionsSidebar(app.page).row(seed.chatId).click();
    await expect(app.page.getByText('Needle turn 249', { exact: true })).toBeInViewport();
  });

  test('keeps selection and Quote usable while most of 400 loaded containers are unmounted', async () => {
    const page = app.page;
    for (let count = 80; count <= 400; count += 40) {
      await page.getByTestId('chat-load-earlier').click();
      await expect(page.getByTestId('chat-message-list')).toHaveAttribute('data-loaded-count', String(count));
    }
    await page.getByTestId('chat-scroll-to-bottom').click();
    const tail = page.getByText('Needle turn 249', { exact: true });
    await expect(tail).toBeVisible();
    await expect.poll(() => page.getByTestId('chat-user-message').count()).toBeLessThan(30);
    await tail.click({ clickCount: 3 });
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toContain('Needle turn 249');
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toContain('History response 249');
    await tail.click({ clickCount: 3 });
    await expect(page.getByTestId('chat-selection-quote')).toBeVisible();
    await expect.poll(() => page.getByTestId('chat-user-message').count()).toBeLessThan(30);
    await page.getByTestId('chat-selection-quote').click();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('');
    await expect.poll(() => page.getByTestId('chat-user-message').count()).toBeLessThan(30);
    await expect(page.getByTestId('chat-message-list')).toHaveAttribute('data-loaded-count', '400');
  });

  test('restores an opened tool and fetched full output after its virtual row unmounts', async () => {
    const page = app.page;
    let fetches = 0;
    const endpoint = '**/api/chats/*/tool-result/*';
    await page.route(endpoint, (route) => {
      fetches++;
      return route.fulfill({ json: { success: true, data: { content: 'Full virtual output landmark' } } });
    });
    const initial = page.getByTestId('read-card-root').last();
    const messageId = await initial.locator('xpath=ancestor::*[@data-message-id][1]').getAttribute('data-message-id');
    expect(messageId).toBeTruthy();
    const message = page.locator(`[data-message-id="${messageId}"]`);
    const card = message.getByTestId('read-card-root').last();
    await card.getByTestId('read-card-trigger').click();
    await expect(card).toHaveAttribute('data-state', 'open');
    await card.getByTestId('tool-result-expand-toggle').click();
    await expect(card.getByTestId('tool-result-expand-collapse')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+f');
    await page.getByTestId('thread-find-input').fill('ancient landmark');
    await expect(page.getByTestId('find-bar')).toContainText('1/1');
    await page.getByTestId('thread-find-next').click();
    await expect(page.getByText('Needle turn 2 ancient landmark', { exact: true })).toBeVisible();
    await expect(message).toHaveCount(0);
    const pages = wire.pageRequests;
    await page.getByTestId('thread-find-input').fill('Tool summary 249/3');
    await expect(page.getByTestId('find-bar')).toContainText('1/1');
    await page.getByTestId('thread-find-next').click();
    const restored = message.getByTestId('read-card-root').last();
    await expect(restored).toHaveAttribute('data-state', 'open');
    await expect(restored.getByTestId('tool-result-expand-collapse')).toBeVisible();
    await expect(restored.getByText('Full virtual output landmark', { exact: true })).toBeVisible();
    expect(fetches).toBe(1);
    expect(wire.pageRequests).toBe(pages);
    await page.unroute(endpoint);
  });
});

test('legacy daemon find searches rows outside the virtual viewport', async () => {
  const seed = await seedWindowedHistory();
  const wire = new HistoryWire();
  wire.legacy = true;
  let app: TauriAppFixture | undefined;
  try {
    app = await launchTauriApp({
      dataDir: seed.dataDir,
      recordingKey: WINDOWED_RECORDING_KEY,
      recordingsDir: seed.recordingsDir,
      beforeNavigate: (page) => wire.install(page),
    });
    const page = app.page;
    await sessionsSidebar(page).row(seed.chatId).click();
    await expect(page.getByTestId('chat-message-list')).toHaveAttribute('data-loaded-count', '501');
    await expect(page.getByText('Needle turn 249', { exact: true })).toBeInViewport();
    await expect(page.getByText('Needle turn 2 ancient landmark', { exact: true })).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+f');
    await page.getByTestId('thread-find-input').fill('ancient landmark');
    await expect(page.getByTestId('find-bar')).toContainText('1/1');
    await expect(page.getByText('Needle turn 2 ancient landmark', { exact: true })).toBeInViewport();
    expect(wire.pageRequests).toBe(0);
  } finally {
    if (app) await closeTauriApp(app);
    cleanupHeadlessProject(seed.project);
    rmSync(seed.recordingsDir, { recursive: true, force: true });
  }
});
