import { expect, type Page } from '@playwright/test';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DAEMON_BASE } from '../../fixtures/daemon.js';
import { launchTauriApp, closeTauriApp } from '../../fixtures/app-tauri.js';
import { WINDOWED_RECORDING_KEY, WINDOWED_PAGE_CONTAINERS } from '../../fixtures/windowed-history.js';
import { composer, sessionsSidebar } from './page-objects.js';
import type { seedWindowedHistory } from './windowed-history.js';
import { HistoryPerformanceWire } from './history-performance-wire.js';
import { createHeadlessChat } from './headless-chat.js';
import { armHistoryPaint, historyPaintMs, installHistoryPaintProbe } from './history-paint.js';

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

async function openChat(page: Page, chatId: string, wire: HistoryPerformanceWire): Promise<number> {
  const completed = wire.replaysCompleted.get(chatId) ?? 0;
  await armHistoryPaint(page, `[data-testid="sessions-row"][data-chat-id="${chatId}"]`, 'open');
  await sessionsSidebar(page).row(chatId).click();
  await wire.waitForReplay(chatId, completed);
  await expect(page.getByText('Needle turn 249', { exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-thread-loading')).toHaveCount(0);
  return historyPaintMs(page);
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
  await viewport.hover();
  await armHistoryPaint(page, '[data-testid="chat-thread-viewport"]', 'page');
  await page.mouse.wheel(0, -100_000);
  await expect(page.getByTestId('chat-message-list')).toHaveAttribute(
    'data-loaded-count',
    String(WINDOWED_PAGE_CONTAINERS * 2),
  );
  const duration = await historyPaintMs(page);
  for (let count = WINDOWED_PAGE_CONTAINERS * 3; count <= 400; count += WINDOWED_PAGE_CONTAINERS) {
    await page.getByTestId('chat-load-earlier').click();
    await expect(page.getByTestId('chat-message-list')).toHaveAttribute('data-loaded-count', String(count));
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
  await expect(page.locator('[data-virtual-placeholder]')).toHaveCount(0);
  await composer(page).input().focus();
  await armHistoryPaint(page, '[data-testid="chat-composer-input"]', 'key');
  await page.keyboard.type('a');
  const keypressMs = await historyPaintMs(page);
  const cdp = await page.context().newCDPSession(page);
  try {
    const heap = await cdp.send('Runtime.getHeapUsage');
    return { fps, keypressMs, heapBytes: heap.usedSize };
  } finally {
    await cdp.detach();
  }
}

async function launchMeasurement(seed: Seed, dataDir: string, wire: HistoryPerformanceWire, warm: boolean) {
  let other = '';
  const app = await launchTauriApp({
    dataDir,
    recordingKey: WINDOWED_RECORDING_KEY,
    recordingsDir: seed.recordingsDir,
    beforeNavigate: async (page) => {
      other = await createHeadlessChat(seed.project.projectId);
      await page.addInitScript(
        (id) =>
          localStorage.setItem(
            'mf:last-session::local',
            JSON.stringify({ state: { lastSessionId: id, lastByProject: {} }, version: 2 }),
          ),
        other,
      );
      await wire.install(page);
      await installHistoryPaintProbe(page);
      if (warm) {
        const response = await fetch(`${DAEMON_BASE}/api/chats/${seed.chatId}/messages`);
        expect(response.ok).toBe(true);
        await response.arrayBuffer();
      }
    },
  });
  return { app, other };
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
  const wire = new HistoryPerformanceWire(legacy);
  const { app, other } = await launchMeasurement(seed, dataDir, wire, warm);
  try {
    await sessionsSidebar(app.page).row(other).click();
    await wire.waitForReplay(other, 0);
    await expect(app.page.getByTestId('chat-user-message')).toHaveCount(0);
    await expect(app.page.getByTestId('chat-thread-loading')).toHaveCount(0);
    await painted(app.page);
    expect(wire.resumeRequests.get(seed.chatId) ?? 0).toBe(0);
    if (!warm) expect(() => historyLoadMs(dataDir, seed.chatId)).toThrow('Missing daemon history_load_ms');
    wire.resumeBytes = 0;
    const openMs = await openChat(app.page, seed.chatId, wire);
    expect(wire.resumeRequests.get(seed.chatId)).toBe(1);
    const bytes = wire.resumeBytes;
    const otherCompleted = wire.replaysCompleted.get(other) ?? 0;
    await sessionsSidebar(app.page).row(other).click();
    await wire.waitForReplay(other, otherCompleted);
    await expect(app.page.getByTestId('chat-user-message')).toHaveCount(0);
    await expect(app.page.getByTestId('chat-thread-loading')).toHaveCount(0);
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
