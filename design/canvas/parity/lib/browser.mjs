// A page per side, both served without a socket: the prototype from its file, the app from the
// built bundle through request interception. Any other request fails the run.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './build.mjs';

const require = createRequire(join(ROOT, 'packages/e2e/package.json'));
const { chromium } = require('@playwright/test');
const PROTO = join(ROOT, 'design/redesign/prototype/index.html');
const ORIGIN = 'https://parity.invalid';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
export const NOW = Date.UTC(2026, 10, 24, 23, 31, 0);

export const launch = () => chromium.launch({ executablePath: process.env.PARITY_CHROMIUM || undefined });

async function context(browser, view, theme) {
  return browser.newContext({
    viewport: { width: view[0], height: view[1] },
    colorScheme: theme,
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    timezoneId: 'UTC',
    locale: 'en-US',
  });
}

export async function openProto(browser, view, theme) {
  const ctx = await context(browser, view, theme);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  await page.goto(pathToFileURL(PROTO).href);
  await page.evaluate((t) => {
    const p = window.__proto;
    p.theme(t);
    p.ww(Math.max(innerWidth, 1440) === innerWidth ? innerWidth : 1440);
    document.querySelector('#pc').style.display = 'none';
  }, theme);
  return page;
}

export async function openApp(browser, dir, view, theme, scenario = {}, storage = {}) {
  const ctx = await context(browser, view, theme);
  const page = await ctx.newPage();
  const strays = [];
  await ctx.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    const file = join(dir, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (url.origin === ORIGIN && existsSync(file))
      return route.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file)] ?? 'application/octet-stream' });
    if (url.origin === ORIGIN && url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    strays.push(url.href);
    return route.abort();
  });
  page.on('websocket', (ws) => strays.push(ws.url()));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack ?? e)));
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(
    ({ scenario, storage }) => {
      window.__PARITY__ = scenario;
      for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    },
    { scenario, storage: { 'mf-theme': theme, ...storage } },
  );
  await page.goto(`${ORIGIN}/`);
  return { page, strays, errors, misses: () => page.evaluate(() => window.__PARITY_MISSES__) };
}
