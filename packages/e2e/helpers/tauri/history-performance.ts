import { expect, type Page } from '@playwright/test';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DAEMON_BASE } from '../../fixtures/daemon.js';
import { launchTauriApp, closeTauriApp } from '../../fixtures/app-tauri.js';
import { WINDOWED_RECORDING_KEY } from '../../fixtures/windowed-history.js';
import { composer, sessionsSidebar } from './page-objects.js';
import { HistoryWire, type seedWindowedHistory } from './windowed-history.js';
import { createHeadlessChat } from './headless-chat.js';

type Seed = Awaited<ReturnType<typeof seedWindowedHistory>>;
export interface HistoryMeasurement {
  openMs: number;
  historyLoadMs: number;
  switchMs: number;
  pageMs?: number;
  bytes: number;
  fps?: number;
  keypressMs?: number;
  heapBytes?: number;
}

async function painted(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

async function openChat(page: Page, chatId: string, wire: HistoryWire): Promise<number> {
  const completed = wire.replaysCompleted.get(chatId) ?? 0;
  const start = await page.evaluate(() => performance.now());
  await sessionsSidebar(page).row(chatId).click();
  await wire.waitForReplay(chatId, completed);
  await expect(page.getByText('Needle turn 249', { exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-thread-loading')).toHaveCount(0);
  await painted(page);
  return (await page.evaluate(() => performance.now())) - start;
}

function historyLoadMs(dataDir: string, chatId: string): number {
  const logs = path.join(dataDir, 'logs');
  for (const name of readdirSync(logs)) {
    for (const line of readFileSync(path.join(logs, name), 'utf8').split('\n')) {
      try {
        const event = JSON.parse(line) as { fields?: { chat_id?: string; history_load_ms?: number } };
        if (event.fields?.chat_id === chatId && event.fields.history_load_ms !== undefined)
          return event.fields.history_load_ms;
      } catch {
        if (!line.includes('chat history loaded')) continue;
        const id = /chat_id=(?:"([^"]+)"|(\S+))/.exec(line);
        const duration = /history_load_ms=([\d.eE+-]+)/.exec(line);
        if ((id?.[1] ?? id?.[2]) === chatId && duration) return Number(duration[1]);
      }
    }
  }
  throw new Error('Missing daemon history_load_ms measurement');
}

async function pageAndPopulate(page: Page): Promise<number> {
  const viewport = page.getByTestId('chat-thread-viewport');
  await viewport.focus();
  const start = await page.evaluate(() => performance.now());
  await page.keyboard.press('Home');
  await expect(page.getByTestId('chat-user-message')).toHaveCount(40);
  await painted(page);
  const duration = (await page.evaluate(() => performance.now())) - start;
  for (let users = 60; users <= 200; users += 20) {
    await page.getByTestId('chat-load-earlier').click();
    await expect(page.getByTestId('chat-user-message')).toHaveCount(users);
  }
  await painted(page);
  return duration;
}

async function responsiveness(page: Page): Promise<Pick<HistoryMeasurement, 'fps' | 'keypressMs' | 'heapBytes'>> {
  const fps = await page.getByTestId('chat-thread-viewport').evaluate(
    (element) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (now: number) => {
          element.scrollTop = ((element.scrollHeight - element.clientHeight) * ((now - start) % 1500)) / 1500;
          frames++;
          if (now - start < 3000) requestAnimationFrame(tick);
          else resolve((frames * 1000) / (now - start));
        };
        requestAnimationFrame(tick);
      }),
  );
  await composer(page).input().focus();
  const start = await page.evaluate(() => performance.now());
  await page.keyboard.type('a');
  await painted(page);
  const keypressMs = (await page.evaluate(() => performance.now())) - start;
  const cdp = await page.context().newCDPSession(page);
  try {
    const heap = await cdp.send('Runtime.getHeapUsage');
    return { fps, keypressMs, heapBytes: heap.usedSize };
  } finally {
    await cdp.detach();
  }
}

export async function measureHistory(
  seed: Seed,
  warm: boolean,
  legacy: false | 'full' | 'uncompressed',
): Promise<HistoryMeasurement> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mf-history-measure-'));
  cpSync(seed.dataDir, dataDir, { recursive: true });
  rmSync(path.join(dataDir, 'cache', 'history'), { recursive: true, force: true });
  rmSync(path.join(dataDir, 'logs'), { recursive: true, force: true });
  const wire = new HistoryWire();
  wire.legacy = legacy !== false;
  wire.uncompressedLegacy = legacy === 'uncompressed';
  let other = '';
  const app = await launchTauriApp({
    dataDir,
    recordingKey: WINDOWED_RECORDING_KEY,
    recordingsDir: seed.recordingsDir,
    beforeNavigate: async (page) => {
      other = await createHeadlessChat(seed.project.projectId);
      await wire.install(page);
      if (warm) {
        const response = await fetch(`${DAEMON_BASE}/api/chats/${seed.chatId}/messages`);
        expect(response.ok).toBe(true);
        await response.arrayBuffer();
      }
    },
  });
  try {
    await expect(app.page.getByTestId('chat-user-message')).toHaveCount(0);
    wire.resumeBytes = 0;
    const openMs = await openChat(app.page, seed.chatId, wire);
    const bytes = wire.resumeBytes;
    await sessionsSidebar(app.page).row(other).click();
    await expect(app.page.getByTestId('chat-user-message')).toHaveCount(0);
    const switchMs = await openChat(app.page, seed.chatId, wire);
    const result: HistoryMeasurement = { openMs, bytes, switchMs, historyLoadMs: historyLoadMs(dataDir, seed.chatId) };
    if (!legacy) {
      result.pageMs = await pageAndPopulate(app.page);
      Object.assign(result, await responsiveness(app.page));
    }
    return result;
  } finally {
    await closeTauriApp(app);
  }
}

export function percentile95(values: number[]): number {
  expect(values).toHaveLength(10);
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
}
