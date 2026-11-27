// The three engines behind one interface: open(url) a fresh page, call(js) awaiting a JSON string, close().
// Chromium and Playwright WebKit come from packages/e2e's Playwright; `wk` is the WKWebView harness.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const require = createRequire(new URL('../../../../e2e/package.json', import.meta.url));
const VIEWPORT = { width: 1280, height: 720 };

async function playwrightEngine(name, { synthetic }) {
  const { chromium, webkit } = require('@playwright/test');
  const browser = await (name === 'chromium' ? chromium : webkit).launch({ headless: true });
  let page = null;
  return {
    info: { engine: name, version: browser.version() },
    async open(url) {
      page = await browser.newPage({ viewport: VIEWPORT });
      page.on('pageerror', (error) => console.error(`[${name}] pageerror`, error.message));
      if (!synthetic)
        await page.exposeFunction('__rigNative', async ({ type, dy, x, y }) => {
          if (type !== 'wheel') return false;
          await page.mouse.move(x, y);
          await page.mouse.wheel(0, dy);
          return true;
        });
      await page.goto(url);
      await page.waitForFunction(() => window.__rig);
    },
    call: (js) => page.evaluate(`(async () => { ${js} })()`),
    async closePage() {
      await page?.close();
    },
    close: () => browser.close(),
  };
}

async function wkEngine(binary, { synthetic }) {
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = readline.createInterface({ input: child.stdout });
  const waiters = new Map();
  let ready;
  const readyPromise = new Promise((resolve) => (ready = resolve));
  lines.on('line', (line) => {
    const message = JSON.parse(line);
    if (message.ready) ready(message);
    if ('ack' in message) {
      waiters.get(message.ack)?.(message);
      waiters.delete(message.ack);
    }
  });
  const info = await readyPromise;
  let id = 0;
  const send = (command) => child.stdin.write(JSON.stringify(command) + '\n');
  const call = (js, timeoutMs = 180000) =>
    new Promise((resolve, reject) => {
      const key = ++id;
      setTimeout(
        () => waiters.has(key) && (waiters.delete(key), reject(new Error('harness call timed out'))),
        timeoutMs,
      );
      waiters.set(key, (m) =>
        m.error ? reject(new Error(m.error)) : resolve(m.value === undefined ? undefined : JSON.parse(m.value)),
      );
      send({
        cmd: 'call',
        id: key,
        js: `const value = await (async () => { ${js} })(); return JSON.stringify(value ?? null);`,
      });
    });
  return {
    info: { engine: 'wk', ...info },
    async open(url) {
      // The web view is reused: while the old page still answers (`window.__rig` is still there), a call made
      // right after `load` can land on the document that is being torn down and fail with "undefined" or
      // "completion handler no longer reachable", which looked like a lost web process. Leave the old page
      // first, then wait for the new one.
      send({ cmd: 'load', url: 'about:blank' });
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 30));
        try {
          if (!(await call('return Boolean(window.__rig)'))) break;
        } catch {}
      }
      send({ cmd: 'load', url });
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 50));
        try {
          if (await call('return Boolean(window.__rig)')) break;
        } catch {}
      }
      if (synthetic) await call('delete window.__rigNative; return true');
    },
    call,
    async closePage() {},
    close: async () => {
      send({ cmd: 'quit' });
      child.kill();
    },
  };
}

export function openEngine(name, options) {
  return name === 'wk' ? wkEngine(options.wkBinary, options) : playwrightEngine(name, options);
}
