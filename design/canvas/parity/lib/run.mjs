import { scrollTranscriptToBottom, windowTextDiff } from './window-text.mjs';
// Walks the states of an area, measures both sides, writes rows and images.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare } from './compare.mjs';
import { openApp, openProto } from './browser.mjs';
import { compose } from './image.mjs';

const EXTRACT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'extract.js'), 'utf8');
export const VIEWS = { wide: [1440, 900], mid: [1100, 720], small: [860, 720] };

/** Finders a pair's expression may use. `q` is the first visible match. */
const HELPERS = `
  window.__vis = (e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden'; };
  window.qa = (s, r = document) => [...r.querySelectorAll(s)].filter(__vis);
  window.q = (s, r) => qa(s, r)[0] ?? null;
  window.tid = (id) => q('[data-testid="' + id + '"]');
  window.txt = (s, t, r) => qa(s, r).find((e) => e.textContent.replace(/\\s+/g, ' ').trim().startsWith(t)) ?? null;
  window.up = (e, s) => e && e.closest(s);
`;
const STILL =
  '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';

async function ready(page) {
  await page.evaluate(HELPERS);
  await page.evaluate(EXTRACT);
  await page.addStyleTag({ content: STILL });
}

export const BASE_STORAGE = {
  'mf:last-session::local': { state: { lastSessionId: 's1', lastByProject: {} }, version: 2 },
  'mf:tutorial': { state: { completed: true, step: 1 }, version: 0 },
};

/** Two frames and a pause: popovers place themselves after a measure pass. */
export const settle = async (page, ms = 250) => {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(f))));
};

/** Places an element's parts in the window instead of in the element. */
function shiftToWindow(x) {
  for (const part of [...x.texts, ...x.icons, ...x.boxes]) {
    part.rect[0] += x.box.rect[0];
    part.rect[1] += x.box.rect[1];
  }
}

export async function runArea({
  browser,
  dir,
  area,
  outDir,
  themes = ['light', 'dark'],
  views = Object.keys(VIEWS),
  only,
  screenshots = true,
}) {
  const problems = [];
  const counts = { states: 0, elements: 0, checks: 0 };
  mkdirSync(join(outDir, area.id), { recursive: true });
  const jobs = [];
  for (const state of area.states) {
    if (only && !only.test(state.id)) continue;
    for (const viewName of views) {
      if (state.views && !state.views.includes(viewName)) continue;
      for (const theme of themes) jobs.push({ state, viewName, theme, rows: [] });
    }
  }
  const one = async ({ state, viewName, theme, rows }) => {
    const view = VIEWS[viewName];
    const where = `${state.id} ${view.join('×')} ${theme}`;
    const proto = await openProto(browser, view, theme);
    const app = await openApp(browser, dir, view, theme, state.scenario ?? {}, {
      ...BASE_STORAGE,
      ...(state.storage ?? {}),
    });
    try {
      await app.page.waitForSelector('[data-testid="title-bar"]', { timeout: 15_000 });
      await settle(app.page, 900);
      await ready(proto);
      await ready(app.page);
      await (area.before?.proto ?? (() => {}))(proto, state);
      await (area.before?.app ?? (() => {}))(app.page, state);
      await state.proto?.(proto);
      await state.app?.(app.page);
      await settle(proto);
      await settle(app.page);
      if (state.compareWindowText) {
        await Promise.all([scrollTranscriptToBottom(proto, 0), scrollTranscriptToBottom(app.page, 1)]);
        await Promise.all([settle(proto), settle(app.page)]);
        const differences = await windowTextDiff(proto, app.page);
        writeFileSync(join(outDir, area.id, `window-${viewName}-${theme}.txt`), differences.join('\n'));
        if (differences.length)
          problems.push(`${where}: ${differences.length} text differences\n${differences.slice(0, 8).join('\n')}`);
      }
      for (const pair of state.pairs) {
        const pull = (page, expr) =>
          page.evaluate(
            ({ expression, local }) => {
              const el = (0, eval)(expression);
              return el ? window.__extract(el, local) : null;
            },
            { expression: expr, local: pair.local },
          );
        const [p, a] = [await pull(proto, pair.p), await pull(app.page, pair.a ?? pair.p)];
        if (!p || !a) {
          if (!p && !a && pair.optional) continue;
          rows.push({
            area: area.id,
            state: state.id,
            view: viewName,
            theme,
            el: pair.id,
            part: 'element',
            prop: 'present',
            proto: p ? 'yes' : 'no',
            app: a ? 'yes' : 'no',
          });
          continue;
        }
        if (pair.local) {
          p.box.rect.splice(0, 2, 0, 0);
          a.box.rect.splice(0, 2, 0, 0);
        }
        if (pair.abs) (shiftToWindow(p), shiftToWindow(a));
        const { rows: found, checks } = compare(p, a, pair);
        counts.elements++;
        counts.checks += checks;
        for (const r of found) rows.push({ area: area.id, state: state.id, view: viewName, theme, el: pair.id, ...r });
      }
      if (screenshots && state.shot && (!state.shotViews || state.shotViews.includes(viewName))) {
        const clip = async (page, expr) => {
          if (expr === true) return undefined;
          return page.evaluate((e) => {
            const r = (0, eval)(e).getBoundingClientRect();
            const p = 12;
            const x = Math.max(0, r.x - p);
            const y = Math.max(0, r.y - p);
            return {
              x,
              y,
              width: Math.min(innerWidth - x, r.width + 2 * p),
              height: Math.min(innerHeight - y, r.height + 2 * p),
            };
          }, expr);
        };
        const pc = await clip(proto, state.shot === true ? true : state.shot.p);
        const ac = await clip(app.page, state.shot === true ? true : state.shot.a);
        // One clip for both, so a displacement shows in the difference.
        const c =
          pc && ac && !state.shot.own
            ? { x: Math.min(pc.x, ac.x), y: Math.min(pc.y, ac.y), width: 0, height: 0 }
            : null;
        if (c) {
          c.width = Math.max(pc.x + pc.width, ac.x + ac.width) - c.x;
          c.height = Math.max(pc.y + pc.height, ac.y + ac.height) - c.y;
        }
        const shots = [
          await proto.screenshot({ clip: c ?? pc, animations: 'disabled' }),
          await app.page.screenshot({ clip: c ?? ac, animations: 'disabled' }),
        ];
        const png = await compose(browser, shots, theme, `${state.title ?? state.id}, ${view.join('×')}, ${theme}`);
        writeFileSync(join(outDir, area.id, `${state.id}-${viewName}-${theme}.png`), png);
      }
      const misses = await app.misses();
      if (misses.length) problems.push(`${where}: not in fixtures: ${[...new Set(misses)].join('; ')}`);
      if (app.strays.length) problems.push(`${where}: NETWORK: ${app.strays.join('; ')}`);
      if (app.errors.length) problems.push(`${where}: page error: ${app.errors[0].slice(0, 300)}`);
    } catch (e) {
      problems.push(`${where}: ${String(e.message ?? e).slice(0, 400)}`);
      if (screenshots)
        await app.page
          .screenshot({ path: join(outDir, area.id, `failed-${state.id}-${viewName}-${theme}.png`) })
          .catch(() => {});
    } finally {
      await proto.context().close();
      await app.page.context().close();
    }
  };
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: Number(process.env.PARITY_JOBS ?? 5) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) await one(job);
    }),
  );
  const rows = jobs.flatMap((job) => job.rows);
  counts.states = jobs.length;
  return { rows, problems, counts };
}
