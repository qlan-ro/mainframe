// Shared moves. A state names what both sides do to reach it.
export const P = {
  preset: (id) => (page) => page.evaluate((i) => window.__proto.preset(i), id),
  hover: (expr) => async (page) => {
    const r = await page.evaluate((e) => {
      const q = (0, eval)(e)?.getBoundingClientRect();
      return q ? [q.x + q.width / 2, q.y + q.height / 2] : null;
    }, expr);
    if (!r) throw new Error(`nothing to hover: ${expr}`);
    await page.mouse.move(r[0], r[1]);
  },
  hoverAt: (expr, dx, dy) => async (page) => {
    const r = await page.evaluate((e) => {
      const q = (0, eval)(e).getBoundingClientRect();
      return [q.x, q.y];
    }, expr);
    await page.mouse.move(r[0] + dx, r[1] + dy);
  },
  click: (expr) => async (page) => {
    const r = await page.evaluate((e) => {
      const q = (0, eval)(e)?.getBoundingClientRect();
      return q ? [q.x + q.width / 2, q.y + q.height / 2] : null;
    }, expr);
    if (!r) throw new Error(`nothing to click: ${expr}`);
    await page.mouse.click(r[0], r[1]);
    await page.waitForTimeout(150);
  },
  /** Keyboard focus: a key press first, so `:focus-visible` matches. */
  focus: (expr) => async (page) => {
    await page.keyboard.press('Shift');
    await page.evaluate((e) => (0, eval)(e).focus({ focusVisible: true }), expr);
  },
  /** Opens a menu from the keyboard, as both sides then focus an item. */
  openByKey: (expr) => async (page) => {
    await page.keyboard.press('Shift');
    await page.evaluate((e) => (0, eval)(e).focus({ focusVisible: true }), expr);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
  },
  key: (k) => (page) => page.keyboard.press(k),
  type: (t) => (page) => page.keyboard.type(t),
  js: (code) => (page) => page.evaluate((c) => void (0, eval)(c), code),
  park: (page) => page.mouse.move(640, 320),
  wait: (ms) => (page) => page.waitForTimeout(ms),
  all: (...fs) => async (page) => {
    for (const f of fs) await f(page);
  },
};

export const PREFS = (o = {}) => ({
  'mf:ui-prefs': {
    state: { sidebarVisible: true, sidebarWidth: 260, sidebarView: 'chats', sessionPanelOpen: true, sessionPanelSections: {}, sessionPanelHiddenSections: [], transcriptWidth: 780, transcriptMode: 'verbose', enterWhileRunning: 'queue', activityStripCollapsed: false, dialogSizes: {}, dontWarnOnTuningChange: true, ...o },
    version: 9,
  },
});
export const TABS = (ids = ['s1', 's2']) => ({ 'mf:session-tabs': { v: 4, ids, preview: null } });
/** The real app opens the workspace for a running launch configuration; the prototype's window has it closed. */
export const closeWorkspace = async (page) => {
  const pressed = () =>
    page.evaluate(() => document.querySelector('[data-testid="surface-rail-workspace"]')?.getAttribute('aria-pressed') === 'true');
  // It opens by itself once the launch status arrives, so wait for that before closing it, and check it stays closed.
  for (let quiet = 0, seen = false, i = 0; quiet < (seen ? 8 : 30) && i < 80; i++) {
    if (await pressed()) {
      await page.evaluate(() => document.querySelector('[data-testid="surface-rail-workspace"]').click());
      seen = true;
      quiet = 0;
    } else quiet++;
    await page.waitForTimeout(100);
  }
  // The app focuses the composer when a session opens; the prototype's window has no focus.
  await page.evaluate(() => document.activeElement?.blur?.());
};
export const base = { proto: P.preset('idle'), app: closeWorkspace, storage: { ...PREFS(), ...TABS() } };
