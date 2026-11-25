import { P, PREFS, TABS, base, closeWorkspace } from './common.mjs';

const frame = { p: "q('#frame')", a: "tid('chat-composer-frame')" };
const card = { id: 'card', p: "q('#card')", a: "tid('chat-composer')" };
const strip = { id: 'activity strip', p: "q('#top')", a: "tid('composer-activity-strip')" };
const bottom = { id: 'bottom strip', p: "q('#bstrip')", a: "tid('composer-bottom-strip')" };
const menu = { id: 'menu', p: "q('.menu')", a: "q('[role=menu]')" };
const shot = { p: "q('#composer')", a: "tid('chat-composer-frame').parentElement" };
const withMenu = (a = "q('[role=menu]')") => ({ p: "q('.menu')", a });
/** The app after its workspace is closed and `f` ran. */
const app = (...f) => P.all(closeWorkspace, ...f);
const FIELD = "tid('chat-composer-input')";
const typeBoth = (text) => ({
  proto: P.all(P.click("q('#field')"), P.type(text), P.js("document.activeElement.blur()")),
  app: P.all(P.click(FIELD), P.type(text), P.js("document.activeElement.blur()")),
});
const T = 'Also check the weekly window';
const typed = typeBoth(T);
const blur = P.js('document.activeElement.blur()');
const wide = ['wide'];
const narrow = (w) => P.js(`(() => { const f = document.querySelector('[data-testid=chat-composer-frame]'); f.style.width = '${w}px'; f.style.margin = '0 auto'; const c = document.querySelector('[data-testid=composer-bottom-strip]'); if (c) { c.style.width = '${w}px'; c.style.margin = '0 auto'; } })()`);
const btn = {
  plus: { id: 'add button', p: "q('[data-id=plus]')", a: "tid('composer-add-menu')" },
  model: { id: 'model', p: "q('[data-id=model]')", a: "tid('composer-model-select')" },
  perm: { id: 'permissions', p: "q('[data-id=perm]')", a: "tid('composer-permission-mode-select')" },
  ring: { id: 'context ring', p: "q('[data-id=ring]')", a: "tid('composer-context-percent')" },
};
const files = async (page, list) => {
  await P.click("tid('composer-add-menu')")(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), P.click("tid('composer-add-attachment')")(page)]);
  await chooser.setFiles(list);
  await page.waitForTimeout(400);
};
// 1280×800, as the prototype's screenshot says it is.
const png = (page) =>
  page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1280;
    c.height = 800;
    const g = c.getContext('2d');
    g.fillStyle = '#ddd';
    g.fillRect(0, 0, 1280, 800);
    return c.toDataURL('image/png').split(',')[1];
  });
const FILES = async (page) => [
  { name: 'quota-trace.log', mimeType: 'text/plain', buffer: Buffer.alloc(14 * 1024, 97) },
  { name: 'capsule-after-reset.png', mimeType: 'image/png', buffer: Buffer.from(await png(page), 'base64') },
  { name: 'manager.rs.diff', mimeType: 'text/plain', buffer: Buffer.alloc(6 * 1024, 97) },
];
const draft = (items) => `window.__STORES__.draft.getState().add('s1', ${JSON.stringify(items)})`;
const CAPS = [
  { kind: 'capture', type: 'element', imageDataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=', selector: '.capsule .meter > span.pct', note: 'Still reads 100% after the weekly reset' },
  { kind: 'capture', type: 'element', imageDataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=', selector: '.capsule .reset', note: 'Show the next reset time here' },
  { kind: 'code', filePath: 'src/codex.rs', startLine: 32, endLine: 38, lineContent: 'x', note: 'Keep resets_at when the window resets' },
  { kind: 'capture', type: 'screenshot', imageDataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=', region: { w: 640, h: 180 }, note: '' },
];
const quotes = `(() => { const s = window.__STORES__.segments.getState();
  s.append('s1', { quote: 'snapshot() in codex.rs returns the last rate_limits event as-is, and Codex only sends one while a turn runs', liveText: '', source: 'From the reply at 11:19 PM' });
  s.append('s1', { quote: 'QuotaWindow::reset drops resets_at, so the tooltip loses the next reset time until the following turn.', liveText: 'Does that also hold for the 5-hour window?', source: 'From the reply at 11:27 PM' }); })()`;

const S = (id, title, o) => ({ id, title, ...base, views: wide, shot, ...o });

export default {
  id: 'composer',
  states: [
    S('idle', 'Composer at rest', { views: undefined, pairs: [card, strip, bottom, btn.plus, btn.model, btn.perm, btn.ring] }),
    S('focus', 'Field focused', { proto: P.all(P.preset('idle'), P.click("q('#field')")), app: app(P.click(FIELD)), pairs: [card] }),
    S('text', 'Text, ready to send', { scenario: { act: 'none' }, proto: P.all(P.preset('idle-quiet'), typed.proto), app: app(typed.app), pairs: [card, bottom] }),
    S('empty-quiet', 'Empty, nothing running', { scenario: { act: 'none' }, proto: P.preset('idle-quiet'), pairs: [card] }),
    S('running', 'Running, empty', { views: ['wide', 'small'], scenario: { running: true }, proto: P.preset('running-activity'), app: app(blur), pairs: [card, strip] }),
    S('running-text', 'Running, with text', { views: ['wide', 'small'], scenario: { running: true }, proto: P.all(P.preset('running-typed-split'), blur), app: app(typed.app), pairs: [card] }),
    S('split-menu', 'Queue menu', { scenario: { running: true }, proto: P.all(P.preset('running-typed-split'), P.openByKey("q('[data-id=splitmenu]')")), app: app(typed.app, P.openByKey("tid('chat-composer-send-options')")), pairs: [menu], shot: withMenu() }),
    S('stopping', 'Stopping', { scenario: { running: true, act: 'none' }, proto: P.preset('stopping'), app: app(P.click("tid('chat-composer-cancel')"), P.park, blur), pairs: [card] }),
    S('queue', 'Two queued messages', { scenario: { running: true, queue: true }, proto: P.preset('queue-two'), app: app(blur), pairs: [card] }),
    S('needs-you', 'A sub-agent needs you', { scenario: { act: 'need' }, proto: P.preset('needs-you'), app: app(blur), pairs: [strip, card] }),
    S('collapsed', 'Activity strip on one row', { storage: { ...PREFS({ activityStripCollapsed: true }), ...TABS() }, proto: P.all(P.preset('idle'), P.js("document.querySelector('#actstrip .tg').click()"), blur), app: app(blur), pairs: [strip, card] }),
    S('strip-hover', 'Stop hovered', { proto: P.all(P.preset('idle'), P.hover("txt('#actstrip .ab', 'Stop')")), app: app(P.hover("tid('composer-activity-stop')")), pairs: [{ id: 'stop action', p: "txt('#actstrip .ab', 'Stop')", a: "tid('composer-activity-stop')" }] }),
    ...[85, 97].map((ctx) => S(`context-${ctx}`, `Context ${ctx} %`, { scenario: { ctx }, proto: P.all(P.preset(`context-${ctx}`), P.js("document.querySelector('#tip').hidden = true")), pairs: [btn.ring] })),
    S('context-menu', 'Context menu at 97 %', { scenario: { ctx: 97 }, proto: P.all(P.preset('context-97'), P.js("document.querySelector('#tip').hidden = true"), P.openByKey("q('[data-id=ring]')")), app: app(P.openByKey("tid('composer-context-percent')")), pairs: [menu], shot: withMenu("q('[role=menu],[data-slot=popover-content]')") }),
    S('perm-auto', 'Permissions: Auto', { scenario: { perm: 'auto' }, proto: P.preset('perm-auto'), pairs: [btn.perm] }),
    S('perm-unattended', 'Permissions: Unattended', { scenario: { perm: 'yolo' }, proto: P.preset('perm-unattended'), pairs: [btn.perm] }),
    S('perm-menu', 'Permissions menu', { proto: P.all(P.preset('idle'), P.openByKey("q('[data-id=perm]')")), app: app(P.openByKey("tid('composer-permission-mode-select')")), pairs: [menu, { ...btn.perm, id: 'permissions, open' }], shot: withMenu() }),
    S('model-menu', 'Model menu', { scenario: { act: 'none' }, proto: P.all(P.preset('idle-quiet'), P.openByKey("q('[data-id=model]')")), app: app(P.openByKey("tid('composer-model-select')")), pairs: [menu, { ...btn.model, id: 'model, open' }], shot: withMenu() }),
    S('plus-menu', 'Add menu', { proto: P.all(P.preset('idle'), P.openByKey("q('[data-id=plus]')")), app: app(P.openByKey("tid('composer-add-menu')")), pairs: [menu, { ...btn.plus, id: 'add button, open' }], shot: withMenu() }),
    S('control-hover', 'A toolbar control hovered', { proto: P.all(P.preset('idle'), P.hover("q('[data-id=perm]')")), app: app(P.hover("tid('composer-permission-mode-select')")), pairs: [{ ...btn.perm, id: 'permissions, hovered' }] }),
    S('control-focus', 'A toolbar control focused', { proto: P.all(P.preset('idle'), P.focus("q('[data-id=perm]')")), app: app(P.focus("tid('composer-permission-mode-select')")), pairs: [{ ...btn.perm, id: 'permissions, focused' }] }),
    S('confirm-unattended', 'Run unattended?', {
      proto: P.all(P.preset('idle'), P.click("q('[data-id=perm]')"), P.click("txt('.menu .mi', 'Unattended')"), P.park),
      app: app(P.click("tid('composer-permission-mode-select')"), P.click("tid('composer-permission-mode-select-option-yolo')"), P.park),
      pairs: [{ id: 'confirm', p: "q('.confirm')", a: "tid('composer-unattended-confirm')" }],
      shot: { p: "q('.confirm')", a: "tid('composer-unattended-confirm')" },
    }),
    S('bottom-local', 'Local checkout', { scenario: { env: 'local', act: 'none' }, proto: P.preset('idle-local'), pairs: [bottom] }),
    S('bottom-temporary', 'Temporary session', { scenario: { env: 'temp', act: 'none', changes: false }, proto: P.preset('bottom-strip-temporary'), pairs: [bottom] }),
    S('bottom-nochanges', 'No changes', { scenario: { changes: false, act: 'none' }, proto: P.preset('idle-nochanges'), pairs: [bottom] }),
    S('bottom-hover', 'Worktree hovered', { proto: P.all(P.preset('idle'), P.hover("q('[data-id=wt]')")), app: app(P.hover("tid('composer-worktree-trigger')")), pairs: [{ id: 'worktree, hovered', p: "q('[data-id=wt]')", a: "tid('composer-worktree-trigger')" }] }),
    S('changes-menu', 'Changes', { proto: P.all(P.preset('idle'), P.openByKey("q('[data-id=chg]')")), app: app(P.openByKey("tid('composer-changes')")), pairs: [{ ...menu, a: "tid('composer-changes-popover')" }], shot: withMenu("tid('composer-changes-popover')") }),
    S('worktree-menu', 'Worktree', { scenario: { act: 'none' }, proto: P.all(P.preset('idle-quiet'), P.openByKey("q('[data-id=wt]')")), app: app(P.openByKey("tid('composer-worktree-trigger')")), pairs: [{ ...menu, a: "tid('composer-worktree-popover')" }], shot: withMenu("tid('composer-worktree-popover')") }),
    S('files', 'Files and an image', {
      scenario: {},
      proto: P.all(P.preset('composer-files'), blur),
      app: async (page) => {
        await closeWorkspace(page);
        await files(page, await FILES(page));
        await P.click(FIELD)(page);
        await P.type('The capsule still reads 100% after the reset; trace and screenshot attached.')(page);
        await blur(page);
        await P.park(page);
      },
      pairs: [card],
    }),
    S('captures', 'Captures and a code note', { scenario: {}, proto: P.all(P.preset('composer-captures'), blur), app: app(P.js(draft(CAPS)), P.click(FIELD), P.type('Fix these two in the capsule.'), blur, P.park), pairs: [card] }),
    S('quotes', 'Quotes', { scenario: {}, proto: P.all(P.preset('composer-quotes'), blur), app: app(P.js(quotes), P.click(FIELD), P.type('And here, keep the reset time.'), blur, P.park), pairs: [card] }),
    S('width-360', 'Composer 360 px wide', { scenario: { running: true }, proto: P.all(P.preset('width-360'), blur), app: app(narrow(360), typed.app), pairs: [{ ...card, box: ['', '', 'width', 'height'] }] }),
    S('width-240', 'Composer 240 px wide', { scenario: { running: true }, proto: P.all(P.preset('width-240'), blur), app: app(narrow(240), typed.app), pairs: [{ ...card, box: ['', '', 'width', 'height'] }] }),
  ],
};
void frame;
