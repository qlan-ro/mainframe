import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { startDaemon, stopDaemon, type DaemonHandle } from './daemon.js';
import { PREVIEW_BASE } from './global-setup.js';
import { waitConnected } from '../helpers/tauri/wait.js';

export interface TauriAppFixture {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  daemonHandle: DaemonHandle;
}

// The Chromium instance is a whole OS process where a fresh BrowserContext gives the same storage
// isolation for a fraction of the cost, so it's launched once and shared across every describe in
// the worker (each describe gets its own context + page). Playwright kills browsers it launched on
// process exit; the signal handlers below just close it eagerly on Ctrl-C so a killed run doesn't
// leave a headless Chromium reparented to init.
let sharedBrowser: Browser | undefined;
let signalHooksInstalled = false;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;
  // MF_E2E_HEADED=1 shows the browser (optionally MF_E2E_SLOWMO=<ms> to slow actions down for a
  // human watching). The fixture launches Chromium itself, so Playwright's --headed flag never
  // reaches this call.
  sharedBrowser = await chromium.launch({
    headless: process.env['MF_E2E_HEADED'] !== '1',
    slowMo: Number(process.env['MF_E2E_SLOWMO']) || 0,
  });
  if (!signalHooksInstalled) {
    signalHooksInstalled = true;
    const kill = (): void => void sharedBrowser?.close().catch(() => {});
    process.once('SIGINT', kill);
    process.once('SIGTERM', kill);
  }
  return sharedBrowser;
}

// Suppress the first-run tour before first paint. `useFirstRunTour` auto-arms it ~1.5s after boot
// on any workspace with zero real sessions (features/tour/use-first-run-tour.ts); a describe whose
// beforeAll seeds a project but no chat (e.g. external-session-import) would otherwise race the
// coachmark overlay (`tour-overlay`, z-11500) onto the screen mid-test, intercepting clicks meant
// for the sidebar underneath. Seeding it via addInitScript (vs the old goto→set→reload) means the
// overlay never arms in the first place — one boot instead of two.
//
// addInitScript re-runs on every navigation, so it also re-seeds on reload — which means a describe
// that needs the tour to actually arm (window-states' First-run tour) can't just removeItem+reload;
// it must opt out via `suppressTour: false` so no init script is registered on its context.
const TOUR_SUPPRESS = JSON.stringify({ state: { completed: true, step: 4 }, version: 0 });

export async function launchTauriApp(opts?: {
  recordingKey?: string;
  suppressTour?: boolean;
  mockMaxDelayMs?: number;
}): Promise<TauriAppFixture> {
  const daemonHandle = await startDaemon({
    recordingKey: opts?.recordingKey,
    mockMaxDelayMs: opts?.mockMaxDelayMs,
  });
  let context: BrowserContext | undefined;
  try {
    const browser = await getBrowser();
    context = await browser.newContext();
    if (opts?.suppressTour !== false) {
      await context.addInitScript((value: string) => localStorage.setItem('mf:tutorial', value), TOUR_SUPPRESS);
    }
    const page = await context.newPage();
    await page.goto(PREVIEW_BASE, { waitUntil: 'domcontentloaded' });
    await waitConnected(page);

    return { browser, context, page, daemonHandle };
  } catch (err) {
    await context?.close().catch(() => {});
    await stopDaemon(daemonHandle);
    throw err;
  }
}

export async function closeTauriApp(fixture: TauriAppFixture | undefined): Promise<void> {
  if (!fixture) return;
  try {
    await fixture.context.close();
  } catch (err) {
    console.warn('[e2e-tauri] context.close failed; continuing teardown:', err);
  }
  await stopDaemon(fixture.daemonHandle);
}
