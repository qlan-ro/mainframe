// Turns one or more results files into the P1-P7 verdict table (Markdown) and a detail table.
//   node summarize.mjs results-chromium.json results-webkit.json results-wk.json
import fs from 'node:fs';

const log = (line) => process.stdout.write(`${line}\n`);
const results = process.argv.slice(2).flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).results);
const ENGINES = ['chromium', 'wk', 'webkit'];
const VARIANTS = [...new Set(['v0', 'v1', 'v1s', 'v2', ...results.map((r) => r.variant)])];
const NAMES = { chromium: 'Chromium', wk: 'WKWebView (Safari 27 WebKit)', webkit: 'Playwright WebKit' };

const of = (engine, variant, prefix) =>
  results.filter((r) => r.engine === engine && r.variant === variant && r.case.startsWith(prefix));
const res = (rows) => rows.filter((r) => r.ok && r.result).map((r) => r.result);
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
const max = (xs) => (xs.length ? Math.max(...xs.map((x) => (x === null || x === undefined ? Infinity : x))) : NaN);
const fmt = (n) => (Number.isFinite(n) ? String(Math.round(n * 10) / 10) : n === Infinity ? 'lost' : 'n/a');
const verdict = (pass, text) => (pass === null ? `– ${text}` : `${pass ? 'pass' : '**fail**'} ${text}`);

const drift = (rows) => max(res(rows).map((r) => (r.anchorLost ? Infinity : r.maxDrift)));
const mounts = (e, v, prefix) =>
  of(e, v, prefix)
    .filter((r) => r.boot)
    .map((r) => r.boot.mountMs);

const PROPS = {
  P1: (e, v) => {
    const d = drift(of(e, v, 'P1-middle'));
    return verdict(Number.isFinite(d) ? d <= 1 : res(of(e, v, 'P1-middle')).length ? false : null, `${fmt(d)} px`);
  },
  'P1 at offset 0': (e, v) => {
    const d = drift(of(e, v, 'P1-top'));
    return verdict(res(of(e, v, 'P1-top')).length ? d <= 1 : null, `${fmt(d)} px`);
  },
  P2: (e, v) => {
    const ctrl = res(of(e, v, 'P2-control'));
    const page = res(of(e, v, 'P2-page'));
    if (!ctrl.length || !page.length) return verdict(null, 'n/a');
    const off = max(page.map((p) => Math.abs(p.finalTop - median(ctrl.map((c) => c.finalTop)))));
    const against = max(page.map((p) => p.againstWheel));
    return verdict(off <= 2 && against <= 2, `end ${fmt(off)} px, against ${fmt(against)} px`);
  },
  P3: (e, v) => {
    const parts = ['image', 'code', 'fold'].map((c) => ['up', 'down'].map((d) => drift(of(e, v, `P3-${c}-${d}`))));
    const all = parts.flat();
    if (!all.some(Number.isFinite) && !all.includes(Infinity)) return verdict(null, 'n/a');
    const text = ['img', 'code', 'fold'].map((c, i) => `${c} ${fmt(parts[i][0])}/${fmt(parts[i][1])}`).join(', ');
    return verdict(
      all.every((d) => d <= 1),
      `${text} (up/down)`,
    );
  },
  P4: (e, v) => {
    const follow = res(of(e, v, 'P4-follow'));
    const up = res(of(e, v, 'P4-wheel-up'));
    if (!follow.length || !up.length) return verdict(null, 'n/a');
    const gap = max(follow.map((f) => Math.max(f.worstGapStreaming, f.worstGapAfterFold)));
    const released = up.every((u) => u.stayedReleased);
    const jump = max(up.map((u) => (u.jumpFrames < 0 ? Infinity : u.jumpFrames)));
    const after = max(up.map((u) => u.worstGapAfterJump));
    const pass = gap <= 1 && released && jump <= 2 && after <= 1;
    return verdict(
      pass,
      `gap ${fmt(gap)} px, wheel-up ${released ? 'releases' : 'does not hold'}, jump ${fmt(jump)} fr, then gap ${fmt(after)} px`,
    );
  },
  'P4 wheel down while following': (e, v) => {
    const down = res(of(e, v, 'P4-wheel-down'));
    if (!down.length) return verdict(null, 'n/a');
    const kept = down.every((d) => d.stayedFollowing);
    return verdict(kept, kept ? 'keeps following' : 'releases follow');
  },
  P5: (e, v) => {
    const boots = of(e, v, 'P5-open')
      .filter((r) => r.boot)
      .map((r) => r.boot);
    if (!boots.length) return verdict(null, 'n/a');
    const ok = boots.every((b) => b.lastRowOnFirstFrame && b.hiddenFrames === 0);
    return verdict(ok, ok ? 'last row on first frame' : `hidden ${max(boots.map((b) => b.hiddenFrames))} fr`);
  },
  'P6 mount 40': (e, v) => {
    const m = median(mounts(e, v, 'P5-open'));
    const base = median(mounts(e, 'v0', 'P5-open'));
    return verdict(Number.isFinite(m) ? m <= base + 15 : null, `${fmt(m)} ms (v0 ${fmt(base)})`);
  },
  'P6 scroll 400': (e, v) => {
    const r = res(of(e, v, 'P6-scroll-400'));
    const fps = median(r.map((x) => x.fps));
    return verdict(
      r.length ? fps >= 50 : null,
      `${fmt(fps)} fps, p95 frame ${fmt(median(r.map((x) => x.frameP95)))} ms`,
    );
  },
  'P6 chunk p95': (e, v) => {
    // React render time per chunk (Profiler); older runs only have the write-to-DOM latency.
    const pick = (prefix) => {
      const rows = res(of(e, v, prefix));
      const profiled = rows.filter((x) => x.renderP95 !== undefined);
      return profiled.length
        ? { render: max(profiled.map((x) => x.renderP95)), latency: max(profiled.map((x) => x.writeToDomP95)) }
        : null;
    };
    const at40 = pick('P4-follow');
    const at400 = pick('P6-stream-400');
    if (!at40 || !at400) return verdict(null, 'n/a');
    return verdict(
      at40.render <= 8 && at400.render <= 8,
      `render ${fmt(at40.render)} / ${fmt(at400.render)} ms, latency ${fmt(at40.latency)} / ${fmt(at400.latency)} ms (40 / 400 groups)`,
    );
  },
  'P7 proxy': (e, v) => {
    const r = res(of(e, v, 'P7-flicks')).filter((x) => x.loads);
    if (!r.length) return verdict(null, e === 'wk' ? 'n/a' : 'no momentum input');
    const held = r.every((x) => x.allHeld);
    return verdict(
      null,
      `${held ? 'anchoring held' : 'anchoring lost'}, stall ${fmt(max(r.map((x) => x.maxStallMs)))} ms, step ${fmt(max(r.map((x) => x.largestStep)))} px`,
    );
  },
};

for (const engine of ENGINES) {
  if (!results.some((r) => r.engine === engine)) continue;
  log(
    `\n### ${NAMES[engine]}\n\n| Property | ${VARIANTS.join(' | ')} |\n| --- | ${VARIANTS.map(() => '---').join(' | ')} |`,
  );
  for (const [name, check] of Object.entries(PROPS))
    log(`| ${name} | ${VARIANTS.map((v) => check(engine, v)).join(' | ')} |`);
  const extra = ['P6-open-10', 'P6-open-20', 'P6-open-400'].map(
    (c) => `| ${c} median ms | ${VARIANTS.map((v) => fmt(median(mounts(engine, v, c)))).join(' | ')} |`,
  );
  log(extra.join('\n'));
  const failed = results.filter((r) => r.engine === engine && !r.ok);
  if (failed.length) log(`\nErrors: ${failed.map((r) => `${r.variant} ${r.case}: ${r.error}`).join('; ')}`);
}
