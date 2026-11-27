/**
 * Streaming-markdown benchmark. Usage, from the repository root:
 *
 *   node packages/ui/benchmarks/streaming-markdown/run.mjs [--webkit] [--footnote] [--samples=3] [--out=<dir>]
 *
 * Starts a temporary Vite server on port 5199 with production React (and the
 * profiling build of react-dom), opens the fixture in Chromium (or WebKit) and
 * prints commit times as JSON. `--out` also writes the raw
 * numbers and light/dark screenshots of the visual fixture to that directory.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(new URL('../../../e2e/package.json', import.meta.url));
const { chromium, webkit } = require('@playwright/test');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const engine = process.argv.includes('--webkit') ? 'webkit' : 'chromium';
const samples = Number(arg('samples') ?? 3);
const out = arg('out');
const fixture = process.argv.includes('--footnote') ? 'footnote' : 'typical';
const query = fixture === 'footnote' ? '?footnote' : '';
const CHUNK = 24;
const INTERVAL = 20;

const root = fileURLToPath(new URL('../../', import.meta.url));
// Production React, with the profiling build of react-dom so `<Profiler>` reports.
process.env.NODE_ENV = 'production';
const server = await createServer({
  root,
  logLevel: 'error',
  cacheDir: 'node_modules/.vite-bench-streaming-markdown',
  optimizeDeps: { entries: ['benchmarks/streaming-markdown/index.html'] },
  resolve: { alias: [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }] },
  // No reloads mid-run: an edit to a source file must not restart a measurement.
  server: { port: 5199, strictPort: true, hmr: false, watch: { ignored: ['**'] } },
});
await server.listen();
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true });
// A cold Vite cache optimises dependencies on the first request; let that finish first.
{
  const warm = await browser.newPage();
  await warm.goto('http://localhost:5199/benchmarks/streaming-markdown/', { timeout: 180_000 });
  await warm.waitForFunction(() => 'bench' in window, null, { timeout: 180_000 });
  await warm.close();
}
const errors = [];

const sorted = (xs) => [...xs].sort((a, b) => a - b);
const pct = (xs, p) => sorted(xs)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (n) => Math.round(n * 100) / 100;
const summary = (xs) => ({
  n: xs.length,
  mean: round(mean(xs)),
  p50: round(pct(xs, 50)),
  p95: round(pct(xs, 95)),
  max: round(Math.max(...xs)),
  total: round(xs.reduce((a, b) => a + b, 0)),
});

async function open(context, query) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:5199/benchmarks/streaming-markdown/${query}`);
  await page.waitForFunction(() => 'bench' in window);
  return page;
}

async function measureChunks() {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await open(context, query);
  const { wall, commits } = await page.evaluate((size) => window.bench.chunk(size), CHUNK);
  const meta = await page.evaluate(() => ({ length: window.bench.length, lines: window.bench.lines }));
  await context.close();
  const ms = wall.map((w) => w.ms);
  const quarter = Math.floor(ms.length / 4);
  return {
    ...meta,
    chunkChars: CHUNK,
    all: summary(ms),
    firstQuarter: summary(ms.slice(0, quarter)),
    lastQuarter: summary(ms.slice(-quarter)),
    profilerRenderMs: summary(commits.map((c) => c.ms)),
  };
}

async function measureLive() {
  const context = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await open(context, query);
  const { commits, elapsed } = await page.evaluate(
    ([size, interval]) => window.bench.live(size, interval),
    [CHUNK, INTERVAL],
  );
  await context.close();
  const ms = commits.map((c) => c.ms);
  const tail = commits.filter((c) => c.length >= 0.75 * commits.at(-1).length).map((c) => c.ms);
  return {
    chunkChars: CHUNK,
    intervalMs: INTERVAL,
    elapsedMs: round(elapsed),
    commits: summary(ms),
    lastQuarterOfReply: summary(tail),
  };
}

async function screenshots(dir) {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ reducedMotion: 'reduce', deviceScaleFactor: 2 });
    const page = await open(context, `?visual&theme=${theme}`);
    await page.waitForTimeout(1500);
    await page.locator('#visual').screenshot({ path: join(dir, `visual-${engine}-${theme}.png`) });
    await context.close();
  }
}

const runs = [];
for (let i = 0; i < samples; i++) runs.push({ chunk: await measureChunks(), live: await measureLive() });
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `results-${engine}-${fixture}.json`), JSON.stringify(runs, null, 2));
  await screenshots(out);
}
await browser.close();
await server.close();
process.stdout.write(`${JSON.stringify({ engine, fixture, runs, errors: [...new Set(errors)] }, null, 2)}\n`);
if (errors.length) process.exitCode = 1;
