// Drives every state of one area (CAPTURE_AREA) and writes .work/<area>.json for build.py.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '../../../packages/e2e/node_modules/@playwright/test/index.mjs';
import type { Page } from '../../../packages/e2e/node_modules/@playwright/test/index.mjs';
import { closeTauriApp, launchTauriApp } from '../../../packages/e2e/fixtures/app-tauri.js';
import { captureHome, PATH_ALIASES, WORK_DIR } from './seed.mts';
import { serialise } from './serialise.mts';
import type { CaptureArea, CaptureContext, CaptureGroup, CaptureState, Crop } from './types.mts';

const AREA = process.env['CAPTURE_AREA'] ?? '';
/** Boards to capture, comma-separated; empty captures the whole area. */
const ONLY = (process.env['CAPTURE_BOARDS'] ?? '').split(',').filter(Boolean);
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

interface Frame {
  board: string;
  id: string;
  caption: string;
  theme: 'light' | 'dark' | null;
  viewport: { width: number; height: number };
  crop: Crop;
  html: string;
}

async function cropOf(page: Page, state: CaptureState, viewport: Frame['viewport']): Promise<Crop> {
  if (typeof state.crop === 'function') return state.crop(page);
  if (Array.isArray(state.crop)) return state.crop;
  if (!state.crop) return [0, 0, viewport.width, viewport.height];
  const box = await page.getByTestId(state.crop).first().boundingBox();
  if (!box) throw new Error(`${state.id}: nothing to crop to for "${state.crop}"`);
  const pad = state.pad ?? 0;
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  return [
    x,
    y,
    Math.min(viewport.width, Math.ceil(box.x + box.width + pad)) - x,
    Math.min(viewport.height, Math.ceil(box.y + box.height + pad)) - y,
  ];
}

async function runGroup(group: CaptureGroup, index: number, css: Set<string>): Promise<Frame[]> {
  const viewport = group.viewport ?? DEFAULT_VIEWPORT;
  const dataDir = path.join(WORK_DIR, `data-${index}`);
  mkdirSync(dataDir, { recursive: true });
  const app = await launchTauriApp({
    ...group.launch,
    dataDir,
    home: captureHome(),
    beforeNavigate: async (page) => {
      page.setDefaultTimeout(15_000);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
      await group.before?.(page);
    },
  });
  const frames: Frame[] = [];
  try {
    const ctx: CaptureContext = { app, page: app.page, vars: {} };
    await group.seed?.(ctx);
    for (const state of group.states) {
      await state.setup?.(ctx);
      await app.page.emulateMedia({ reducedMotion: 'reduce', colorScheme: state.theme ?? 'light' });
      await app.page.waitForTimeout(state.wait ?? 400);
      // Beside the boards' input, what the app itself drew: compare with a shot.cjs render of the board.
      await app.page.screenshot({ path: path.join(WORK_DIR, `${group.board}.${state.id}.png`) });
      const crop = await cropOf(app.page, state, viewport);
      const { html, runtimeCss } = await app.page.evaluate(serialise, PATH_ALIASES);
      for (const sheet of runtimeCss) css.add(sheet);
      frames.push({
        board: group.board,
        id: state.id,
        caption: state.caption ?? '',
        theme: state.theme ?? null,
        viewport,
        crop,
        html,
      });
      console.log(`captured ${group.board} / ${state.id}`);
    }
  } catch (error) {
    await app.page.screenshot({ path: path.join(WORK_DIR, 'failed.png') });
    throw error;
  } finally {
    await closeTauriApp(app);
  }
  return frames;
}

test(`capture ${AREA}`, async () => {
  const area = ((await import(`./areas/${AREA}.mts`)) as { default: CaptureArea }).default;
  const wanted = (board: string) => ONLY.length === 0 || ONLY.includes(board);
  const css = new Set<string>();
  const frames: Frame[] = [];
  for (const [index, group] of area.groups.entries()) {
    if (wanted(group.board)) frames.push(...(await runGroup(group, index, css)));
  }
  const boards = area.boards.filter((board) => wanted(board.file));
  writeFileSync(path.join(WORK_DIR, `${AREA}.json`), JSON.stringify({ boards, frames, runtimeCss: [...css] }));
});
