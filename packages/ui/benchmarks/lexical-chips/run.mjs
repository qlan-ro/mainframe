/**
 * Spike checks for the Lexical chip composer (todo #482). Synthetic fixture,
 * temporary Vite server on port 5199, no daemon. Prints one row per behaviour.
 *
 *   node packages/ui/benchmarks/lexical-chips/run.mjs            # WebKit, Lexical field
 *   node packages/ui/benchmarks/lexical-chips/run.mjs --textarea # WebKit, today's textarea
 *   node packages/ui/benchmarks/lexical-chips/run.mjs --chromium # Chromium (adds the IME check)
 */
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../../e2e/package.json', import.meta.url));
const { chromium, webkit } = require('@playwright/test');
const root = fileURLToPath(new URL('../../', import.meta.url));
const textarea = process.argv.includes('--textarea');
const useChromium = process.argv.includes('--chromium');
const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: true } });
await server.listen();
const browser = await (useChromium ? chromium : webkit).launch({ headless: true });
const context = await browser.newContext();
if (useChromium) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const input = page.locator('[data-testid="chat-composer-input"]');
const popover = page.locator('[data-testid="composer-trigger-popover"]');
const chips = page.locator('[data-directive-type]');
const text = async () => JSON.parse(await page.locator('[data-testid="composer-text"]').innerText());
const sent = async () => JSON.parse(await page.locator('[data-testid="sent"]').innerText());
const settle = (ms = 120) => page.waitForTimeout(ms);
const mod = 'Meta';

async function reset() {
  await page.goto(`http://localhost:5199/benchmarks/lexical-chips/${textarea ? '?textarea' : ''}`);
  await input.waitFor();
  await input.click();
  await settle();
}
async function type(s) {
  await page.keyboard.type(s, { delay: 15 });
  await settle();
}
async function pick(query) {
  await type(query);
  await popover.waitFor({ timeout: 2000 });
  await page.keyboard.press('Enter');
  await settle();
}
async function paste(payload) {
  await input.evaluate((el, p) => {
    const dt = new DataTransfer();
    if (p.text) dt.setData('text/plain', p.text);
    if (p.file) dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, payload);
  await settle(300);
}

const rows = [];
async function check(name, fn) {
  try {
    await reset();
    const { pass, detail } = await fn();
    rows.push({ name, result: pass ? 'pass' : 'fail', detail });
  } catch (err) {
    rows.push({ name, result: 'error', detail: String(err.message).split('\n')[0] });
  }
}

await check('pick a file makes one chip, wire text unchanged', async () => {
  await type('see ');
  await pick('@app');
  const t = await text();
  return { pass: t === 'see @src/app.ts ' && (textarea || (await chips.count()) === 1), detail: JSON.stringify(t) };
});
await check('caret steps over a chip in one move', async () => {
  await type('see ');
  await pick('@app');
  await page.keyboard.press('ArrowLeft'); // over the space
  await page.keyboard.press('ArrowLeft'); // over the chip
  await type('X');
  const t = await text();
  return { pass: t === 'see X@src/app.ts ', detail: JSON.stringify(t) };
});
await check('caret cannot land inside a chip (click on it)', async () => {
  await type('see ');
  await pick('@app');
  const box = await page.locator('[data-directive-type]').first().boundingBox().catch(() => null);
  if (!box) return { pass: false, detail: 'no chip element (textarea draws none)' };
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await type('X');
  const t = await text();
  // Wherever the click leaves the caret, the token's characters stay together.
  return { pass: t.includes('@src/app.ts') && (await chips.count()) === 1, detail: JSON.stringify(t) };
});
await check('Backspace deletes a chip whole', async () => {
  await type('see ');
  await pick('@app');
  await page.keyboard.press('Backspace'); // space
  await page.keyboard.press('Backspace'); // chip
  const t = await text();
  return { pass: t === 'see ', detail: JSON.stringify(t) };
});
await check('Delete (forward) deletes a chip whole', async () => {
  await type('see ');
  await pick('@app');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Delete');
  const t = await text();
  return { pass: t === 'see  ', detail: JSON.stringify(t) };
});
await check('undo restores a deleted chip, redo removes it', async () => {
  await type('see ');
  await pick('@app');
  await settle(1100); // past the history merge window
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await settle(1100);
  await page.keyboard.press(`${mod}+z`);
  await settle();
  const undone = await text();
  const chipBack = textarea || (await chips.count()) === 1;
  await page.keyboard.press(`${mod}+Shift+z`);
  await settle();
  const redone = await text();
  return {
    pass: undone.includes('@src/app.ts') && chipBack && !redone.includes('@src/app.ts'),
    detail: `undo ${JSON.stringify(undone)} redo ${JSON.stringify(redone)}`,
  };
});
await check('undo steps back over a pick', async () => {
  await type('see ');
  await settle(1100);
  await pick('@app');
  await page.keyboard.press(`${mod}+z`);
  await settle();
  const t = await text();
  return { pass: !t.includes('@src/app.ts'), detail: JSON.stringify(t) };
});
await check('paste of copied text brings chips back', async () => {
  await paste({ text: 'look at @src/app.ts and /review' });
  const t = await text();
  const n = await chips.count();
  return { pass: t === 'look at @src/app.ts and /review' && (textarea ? false : n === 1), detail: `${JSON.stringify(t)} chips=${n}` };
});
await check('copy then paste in the field keeps chips (keyboard)', async () => {
  await type('a ');
  await pick('@app');
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+c`);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(`${mod}+v`);
  await settle(300);
  const t = await text();
  const n = await chips.count();
  return { pass: t === 'a @src/app.ts a @src/app.ts ' && n === 2, detail: `${JSON.stringify(t)} chips=${n}` };
});
await check('directory pick stays open for drill-down, then a file chips', async () => {
  await type('@src');
  await popover.waitFor();
  const dir = page.locator('[data-testid="composer-file-item-src"]');
  await dir.click();
  await settle();
  const mid = await text();
  const stillOpen = await popover.isVisible();
  await page.keyboard.press('Enter');
  await settle();
  const t = await text();
  return { pass: mid === '@src/' && stillOpen && t === '@src/app.ts ', detail: `${JSON.stringify(mid)} open=${stillOpen} → ${JSON.stringify(t)}` };
});
await check('path with spaces becomes one quoted chip', async () => {
  await pick('@notes');
  const t = await text();
  return { pass: t === '@"docs/my notes.md" ' && (textarea || (await chips.count()) === 1), detail: JSON.stringify(t) };
});
await check('/ command becomes a chip', async () => {
  await pick('/rev');
  const t = await text();
  return { pass: t === '/review ' && (textarea || (await chips.count()) === 1), detail: JSON.stringify(t) };
});
await check('session mention chips and re-chips after a remount', async () => {
  await pick('@login');
  const before = await text();
  await page.evaluate(() => window.__fixture.remount?.());
  await settle(300);
  const after = await text();
  const kinds = await chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-directive-type')));
  return { pass: before === '@Fix login bug ' && after === before && kinds.join() === 'session', detail: `${JSON.stringify(after)} chips=${kinds}` };
});
await check('draft restored from the runtime comes back as chips', async () => {
  await page.evaluate(() => window.__fixture.aui.composer.setText('/review look at @src/app.ts\nand @"a b.md"'));
  await settle(300);
  const n = await chips.count();
  return { pass: n === 3, detail: `chips=${n} text=${JSON.stringify(await text())}` };
});
await check('Enter sends the plain text and clears the field', async () => {
  await type('hello ');
  await pick('@app');
  await page.keyboard.press('Enter');
  await settle();
  const s = await sent();
  const editorEmpty = (await input.innerText()).trim() === '';
  return { pass: s[0]?.text === 'hello @src/app.ts ' && s[0]?.mode === 'send' && editorEmpty, detail: JSON.stringify(s) };
});
await check('⌘Z after a send leaves the field empty', async () => {
  await type('hello');
  await settle(1100);
  await page.keyboard.press('Enter');
  await settle();
  await page.keyboard.press(`${mod}+z`);
  await settle();
  const t = await text();
  return { pass: t === '', detail: JSON.stringify(t) };
});
await check('Shift+Enter inserts a new line', async () => {
  await type('a');
  await page.keyboard.press('Shift+Enter');
  await type('b');
  const t = await text();
  return { pass: t === 'a\nb', detail: JSON.stringify(t) };
});
await check('mid-run Enter steers, Alt+Enter queues', async () => {
  await page.locator('[data-testid="running"]').check();
  await input.click();
  await type('one');
  await page.keyboard.press('Enter');
  await settle();
  await type('two');
  await page.keyboard.press('Alt+Enter');
  await settle();
  const s = await sent();
  return { pass: s.map((x) => `${x.text}:${x.mode}`).join() === 'one:steer,two:queue', detail: JSON.stringify(s) };
});
await check('Enter in the open menu picks instead of sending', async () => {
  await type('@app');
  await popover.waitFor();
  await page.keyboard.press('Enter');
  await settle();
  return { pass: (await sent()).length === 0 && (await text()) === '@src/app.ts ', detail: JSON.stringify(await text()) };
});
await check('Arrow keys move the menu highlight', async () => {
  await type('@');
  await popover.waitFor();
  await page.keyboard.press('ArrowDown');
  await settle();
  const idx = await page.locator('[data-highlighted]').evaluate((el) => [...el.closest('[role=listbox]').querySelectorAll('button')].indexOf(el));
  return { pass: idx === 1, detail: `highlighted=${idx}` };
});
await check('Esc closes the menu first, then parks focus on the transcript', async () => {
  await type('@');
  await popover.waitFor();
  await page.keyboard.press('Escape');
  await settle();
  const closed = !(await popover.isVisible());
  const stillInField = await input.evaluate((el) => el === document.activeElement || el.contains(document.activeElement));
  await page.keyboard.press('Escape');
  await settle();
  const onTranscript = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  return { pass: closed && stillInField && onTranscript === 'transcript', detail: `closed=${closed} field=${stillInField} then=${onTranscript}` };
});
await check('no false menu right after a chip', async () => {
  await pick('@app');
  await page.keyboard.press('Backspace'); // remove the space; caret touches the chip
  await settle();
  return { pass: !(await popover.isVisible()), detail: `open=${await popover.isVisible()}` };
});
await check('Shift+Tab reaches the permission cycle', async () => {
  await page.keyboard.press('Shift+Tab');
  await settle();
  return { pass: (await sent()).some((s) => s.text === '<shift-tab>'), detail: JSON.stringify(await sent()) };
});
await check('+ Mention opens the @ menu', async () => {
  if (textarea) return { pass: false, detail: 'fixture wires the button for Lexical only' };
  await type('hi');
  await page.locator('[data-testid="open-mention"]').click();
  await settle();
  return { pass: (await text()) === 'hi @' && (await popover.isVisible()), detail: JSON.stringify(await text()) };
});
await check('pasted file becomes an attachment', async () => {
  await paste({ file: true });
  const n = await page.locator('[data-testid="attachment-count"]').innerText();
  return { pass: n === '1' && (await text()) === '', detail: `attachments=${n}` };
});
await check('combobox ARIA is on the editable element', async () => {
  const closed = await input.evaluate((el) => [el.getAttribute('role'), el.getAttribute('aria-expanded')].join());
  await type('@');
  await popover.waitFor();
  const open = await input.evaluate((el) => [el.getAttribute('aria-expanded'), !!el.getAttribute('aria-activedescendant')].join());
  return { pass: closed === 'combobox,false' && open === 'true,true', detail: `closed=${closed} open=${open}` };
});
await check('focus helpers find the field by test id', async () => {
  await page.locator('[data-testid="transcript"]').focus();
  await page.evaluate(() => document.querySelector('[data-testid="chat-composer-input"]').focus());
  await type('x');
  return { pass: (await text()) === 'x', detail: JSON.stringify(await text()) };
});
await check('Enter during IME composition does not send', async () => {
  if (!useChromium) {
    // WebKit has no IME driver: replay the event sequence a composition sends
    // (compositionstart, Enter keydown flagged isComposing/229, compositionend).
    // This checks the Enter guards, not a real input method.
    await type('ni');
    await input.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ni' }));
    });
    await settle();
    const s = await sent();
    return { pass: s.length === 0, detail: `synthetic composition only; sent=${s.length}` };
  }
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 });
  await settle();
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229 });
  await settle();
  await cdp.send('Input.insertText', { text: '日本' });
  await settle();
  const s = await sent();
  return { pass: s.length === 0 && (await text()) === '日本', detail: `sent=${s.length} text=${JSON.stringify(await text())}` };
});

console.log(`\n${useChromium ? 'Chromium' : 'WebKit'} · ${textarea ? 'textarea' : 'Lexical'}\n`);
console.log('| Behaviour | Result | Detail |\n| --- | --- | --- |');
for (const r of rows) console.log(`| ${r.name} | ${r.result} | ${r.detail.replaceAll('|', '\\|')} |`);
if (errors.length) console.log('\nPage errors:\n' + [...new Set(errors)].join('\n'));
await browser.close();
await server.close();
process.exit(rows.some((r) => r.result !== 'pass') ? 1 : 0);
