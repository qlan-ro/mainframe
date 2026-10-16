import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { measureTable } from './table.mjs';
import { baselinePlugin } from './baseline.mjs';
import { measureComplex } from './complex.mjs';
import { measureWindows } from './windows.mjs';

const require = createRequire(new URL('../../../e2e/package.json', import.meta.url));
const { chromium, webkit } = require('@playwright/test');
const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = process.argv.find((arg) => arg.startsWith('--baseline='))?.slice('--baseline='.length);
const server = await createServer({
  root,
  logLevel: 'error',
  plugins: [baselinePlugin(root, baseline)],
  server: { port: 5198, strictPort: true },
});
await server.listen();
const browser = await (process.argv.includes('--webkit') ? webkit : chromium).launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const settle = () => page.waitForTimeout(300);
async function reset() {
  await page.goto(
    `http://localhost:5198/benchmarks/transcript-scroll/?${process.argv.includes('--integrated') ? 'integrated' : ''}${baseline ? '&baseline' : ''}`,
  );
  await page.locator('#toggle').waitFor();
  await settle();
}
const position = () => page.locator('#viewport').evaluate((el) => el.scrollTop);
const grow = () =>
  page.locator('#tail').evaluate((el) => {
    el.style.height = `${el.clientHeight + 100}px`;
  });

async function measureDisclosure() {
  await reset();
  await page.locator('#toggle').click();
  await page.waitForTimeout(30);
  const start = await position();
  await page.locator('#viewport').evaluate((el) => {
    el.scrollTop -= 100;
  });
  await settle();
  const disclosureScrollPx = start - (await position());

  await reset();
  await page.locator('#toggle').click();
  await settle();
  const expanded = await position();
  await grow();
  await settle();
  const readingJumpPx = (await position()) - expanded;
  return { disclosureScrollPx, readingJumpPx };
}

async function measureResize() {
  await reset();
  await page.locator('#viewport').evaluate((el) => {
    el.style.height = '250px';
  });
  await settle();
  const resizeBottomGapPx = await page
    .locator('#viewport')
    .evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);

  await reset();
  await page.locator('#footer').evaluate((el) => {
    el.style.height = '180px';
  });
  await settle();
  const footerBottomGapPx = await page
    .locator('#viewport')
    .evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  return { resizeBottomGapPx, footerBottomGapPx };
}

async function measureStreaming() {
  await reset();
  await page.locator('#viewport').evaluate((el) => {
    el.scrollTop = 300;
  });
  await settle();
  await page.evaluate(() => {
    window.benchmarkFrames = 0;
    window.benchmarkHits = 0;
    const caret = document.caretRangeFromPoint.bind(document);
    document.caretRangeFromPoint = (...args) => {
      window.benchmarkHits++;
      return caret(...args);
    };
    const original = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      window.benchmarkFrames++;
      return original(callback);
    };
  });
  for (let i = 0; i < 30; i++) {
    await grow();
    await page.waitForTimeout(20);
  }
  await settle();
  const idleFrames = await page.evaluate(() => window.benchmarkFrames);
  const idleAnchorHitTests = await page.evaluate(() => window.benchmarkHits);
  let resumeBottomGapPx = 0;
  if (process.argv.includes('--integrated')) {
    await page.locator('#bottom').evaluate((el) => el.click());
    await page.waitForFunction(() => {
      const el = document.getElementById('viewport');
      return el.scrollHeight - el.clientHeight - el.scrollTop <= 1;
    });
    await grow();
    await settle();
    resumeBottomGapPx = await page
      .locator('#viewport')
      .evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  }
  return { idleFrames, idleAnchorHitTests, resumeBottomGapPx };
}

async function measureLateClamp() {
  await reset();
  // WebKit reports the shrink's clamp only after the content has grown again.
  await page.evaluate(() => {
    const tail = document.getElementById('tail');
    tail.style.height = '20px';
    void document.getElementById('viewport').scrollHeight;
    tail.style.height = '400px';
  });
  await settle();
  await grow();
  await settle();
  const lateClampGapPx = await page
    .locator('#viewport')
    .evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  return { lateClampGapPx };
}

async function measure() {
  return {
    ...(await measureDisclosure()),
    ...(await measureResize()),
    ...(await measureStreaming()),
    ...(await measureLateClamp()),
  };
}

try {
  const samples = [];
  for (let i = 0; i < Number(process.argv.find((arg) => arg.startsWith('--samples='))?.split('=')[1] ?? 3); i++)
    samples.push(
      await (process.argv.includes('--windows')
        ? (async () => ({
            ...(await measureWindows(page)),
            ...(process.argv.includes('--complex') ? await measureComplex(page) : {}),
          }))()
        : process.argv.includes('--table')
          ? measureTable(page)
          : measure()),
    );
  if (errors.length) throw new Error(errors.join('\n'));
  process.stdout.write(
    `${JSON.stringify({ baseline: baseline ?? null, browser: browser.browserType().name(), samples }, null, 2)}\n`,
  );
  if (
    process.argv.includes('--check') &&
    samples.some((s) =>
      process.argv.includes('--windows')
        ? Object.values(s).some((value) => Math.abs(value) > 2)
        : process.argv.includes('--table')
          ? s.columnShiftPx > 1 ||
            s.existingRowHeightShiftPx > 1 ||
            s.layouts.some((layout) => layout.tableWidth > layout.width)
          : Math.abs(s.disclosureScrollPx - 100) > 1 ||
            Math.abs(s.readingJumpPx) > 1 ||
            s.resizeBottomGapPx > 1 ||
            s.footerBottomGapPx > 1 ||
            s.idleFrames !== 0 ||
            s.idleAnchorHitTests !== 0 ||
            s.resumeBottomGapPx > 1 ||
            s.lateClampGapPx > 1,
    )
  )
    process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
