// Turns one or more results files into the P1-P7 verdict table (Markdown) and a detail table.
//   node summarize.mjs results-chromium.json results-webkit.json results-wk.json
// Each table is headed with the React build the results came from (profiling or plain react-dom).
import fs from 'node:fs';

const log = (line) => process.stdout.write(`${line}\n`);
const results = process.argv.slice(2).flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).results);
const ENGINES = ['chromium', 'wk', 'webkit'];
const ORDER = ['v0', 'v1', 'v1s', 'v1s-patched', 'v2'];
const VARIANTS = [...new Set([...ORDER, ...results.map((r) => r.variant)])];
const NAMES = { chromium: 'Chromium', wk: 'WKWebView (Safari 27 WebKit)', webkit: 'Playwright WebKit' };

const of = (engine, variant, prefix) =>
  results.filter((r) => r.engine === engine && r.variant === variant && r.case.startsWith(prefix));
const res = (rows) => rows.filter((r) => r.ok && r.result).map((r) => r.result);
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
const max = (xs) => (xs.length ? Math.max(...xs.map((x) => (x === null || x === undefined ? Infinity : x))) : NaN);
const fmt = (n) => (Number.isFinite(n) ? String(Math.round(n * 10) / 10) : n === Infinity ? 'lost' : 'n/a');
const px = (n) => (n === Infinity ? 'anchor lost' : `${fmt(n)} px`);
const verdict = (pass, text) => (pass === null ? `– ${text}` : `${pass ? 'pass' : '**fail**'} ${text}`);

const drift = (rows) => max(res(rows).map((r) => (r.anchorLost ? Infinity : r.maxDrift)));
const mounts = (e, v, prefix) =>
  of(e, v, prefix)
    .filter((r) => r.boot)
    .map((r) => r.boot.mountMs);

/** The P1-P5 rows; `pre` is '' for the settled runs and 'E-' for the runs started while slices still land. */
const props = (pre) => ({
  P1: (e, v) => {
    const d = drift(of(e, v, `${pre}P1-middle`));
    return verdict(Number.isFinite(d) ? d <= 1 : res(of(e, v, `${pre}P1-middle`)).length ? false : null, px(d));
  },
  'P1 at offset 0': (e, v) => {
    const rows = of(e, v, `${pre}P1-top`);
    const d = drift(rows);
    if (!res(rows).length) return verdict(null, 'n/a');
    // The reader must really have been parked at offset 0 (the run records where park() left them).
    const parked = res(rows).map((r) => r.parkedScrollTop);
    const atZero = parked.every((p) => p !== undefined && p <= 1);
    return verdict(
      d <= 1 && atZero,
      `${px(d)}, parked at ${parked.map((p) => (p === undefined ? '?' : fmt(p))).join('/')} px`,
    );
  },
  P2: (e, v) => {
    const ctrl = res(of(e, v, `${pre}P2-control`));
    const page = res(of(e, v, `${pre}P2-page`));
    if (!ctrl.length || !page.length) return verdict(null, 'n/a');
    const off = max(page.map((p) => Math.abs(p.finalTop - median(ctrl.map((c) => c.finalTop)))));
    const pageAgainst = max(page.map((p) => p.againstWheel));
    const ctrlAgainst = max(ctrl.map((c) => c.againstWheel));
    // A jump the control shows too is the plain wheel path, not the page. Both runs must stay within 2 px.
    // Eager runs park at 50% of a height that is still growing, so the control and the page run end in
    // different places by construction: only the movement against the wheel is scored there.
    if (pre)
      return verdict(
        pageAgainst <= 2 && ctrlAgainst <= 2,
        `against ${fmt(pageAgainst)} px (control ${fmt(ctrlAgainst)} px)`,
      );
    const pass = off <= 2 && pageAgainst <= 2 && ctrlAgainst <= 2;
    return verdict(pass, `end ${fmt(off)} px, against ${fmt(pageAgainst)} px (control ${fmt(ctrlAgainst)} px)`);
  },
  P3: (e, v) => {
    const parts = ['image', 'code', 'fold'].map((c) =>
      ['up', 'down'].map((d) => drift(of(e, v, `${pre}P3-${c}-${d}`))),
    );
    const all = parts.flat();
    if (!all.some(Number.isFinite) && !all.includes(Infinity)) return verdict(null, 'n/a');
    const text = ['img', 'code', 'fold'].map((c, i) => `${c} ${fmt(parts[i][0])}/${fmt(parts[i][1])}`).join(', ');
    return verdict(
      all.filter((d) => !Number.isNaN(d)).every((d) => d <= 1),
      `${text} (up/down)`,
    );
  },
  P4: (e, v) => {
    const follow = res(of(e, v, `${pre}P4-follow`));
    const up = res(of(e, v, `${pre}P4-wheel-up`));
    if (!follow.length || !up.length) return verdict(null, 'n/a');
    // A run that never reached the live edge has no gap to report: it fails.
    const reached = follow.every((f) => f.framesToLiveEdge >= 0);
    const gap = reached
      ? max(follow.map((f) => Math.max(f.worstGapStreaming ?? Infinity, f.worstGapAfterFold ?? Infinity)))
      : Infinity;
    const released = up.every((u) => u.stayedReleased);
    const jump = max(up.map((u) => (u.jumpFrames < 0 ? Infinity : u.jumpFrames)));
    const after = max(up.map((u) => u.worstGapAfterJump));
    const pass = reached && gap <= 1 && released && jump <= 2 && after <= 1;
    return verdict(
      pass,
      `${reached ? '' : 'never reached the live edge, '}gap ${fmt(gap)} px, wheel-up ${released ? 'releases' : 'does not hold'}, jump ${fmt(jump)} fr, then gap ${fmt(after)} px`,
    );
  },
  'P4 wheel down while following': (e, v) => {
    const down = res(of(e, v, `${pre}P4-wheel-down`));
    if (!down.length) return verdict(null, 'n/a');
    const kept = down.every((d) => d.stayedFollowing);
    return verdict(kept, kept ? 'keeps following' : 'releases follow');
  },
});

const PROPS = {
  ...props(''),
  P5: (e, v) => {
    const boots = of(e, v, 'P5-open')
      .filter((r) => r.boot)
      .map((r) => r.boot);
    if (!boots.length) return verdict(null, 'n/a');
    // On the first frame the rows are really visible, the last row is in view and the gap is <= 1 px.
    const ok = boots.every((b) => b.lastRowOnFirstFrame && b.firstFrameGap <= 1);
    const gap = max(boots.map((b) => b.firstFrameGap));
    const hidden = max(boots.map((b) => b.hiddenFrames ?? NaN));
    const wrong = max(boots.map((b) => b.wrongFrames ?? NaN));
    return verdict(
      ok,
      ok
        ? `at the end on the first visible frame (${fmt(hidden)} hidden fr)`
        : `first visible frame ${fmt(gap)} px short of the end, ${fmt(wrong)} visible fr before the end, ${fmt(hidden)} hidden fr`,
    );
  },
  'P5 first visible / tail ms': (e, v) => {
    const boots = of(e, v, 'P5-open')
      .filter((r) => r.boot)
      .map((r) => r.boot);
    if (!boots.length || boots.every((b) => b.firstVisibleMs === undefined)) return verdict(null, 'n/a');
    return verdict(
      null,
      `${fmt(median(boots.map((b) => b.firstVisibleMs)))} / ${fmt(median(boots.map((b) => b.mountMs)))} ms`,
    );
  },
  'P6 mount 40': (e, v) => {
    const m = median(mounts(e, v, 'P5-open'));
    const base = median(mounts(e, v.includes('@') ? `v0@${v.split('@')[1]}` : 'v0', 'P5-open'));
    return verdict(Number.isFinite(m) ? m <= base + 15 : null, `${fmt(m)} ms (v0 ${fmt(base)})`);
  },
  'P6 scroll 400': (e, v) => {
    const r = res(of(e, v, 'P6-scroll-400'));
    const fps = r.length ? Math.min(...r.map((x) => x.fps)) : NaN;
    return verdict(r.length ? fps >= 50 : null, `${fmt(fps)} fps, p95 frame ${fmt(max(r.map((x) => x.frameP95)))} ms`);
  },
  'P6 chunk p95': (e, v) => {
    // React render time per chunk (Profiler, profiling build only); older runs only have the write-to-DOM latency.
    const pick = (prefix) => {
      const rows = res(of(e, v, prefix));
      const profiled = rows.filter(
        (x) => x.renderP95 !== undefined && x.renderP95 !== null && !Number.isNaN(x.renderP95),
      );
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

const buildOf = (engine, variantsShown) => {
  const builds = new Set(
    results
      .filter((r) => r.engine === engine && variantsShown.includes(r.variant) && r.ok)
      .map((r) => r.react ?? 'unrecorded'),
  );
  return [...builds].join(' + ');
};

const OPEN_ROWS = Object.fromEntries(
  ['P6-open-10', 'P6-open-20', 'P6-open-400'].map((c) => [`${c} median ms`, (e, v) => fmt(median(mounts(e, v, c)))]),
);

const empty = (cell) => /^(– )?(n\/a|no momentum)/.test(cell);
const table = (title, rows, engine, variants) => {
  log(`\n### ${title}\n\n| Property | ${variants.join(' | ')} |\n| --- | ${variants.map(() => '---').join(' | ')} |`);
  for (const [name, check] of Object.entries(rows)) {
    const cells = variants.map((v) => check(engine, v));
    if (!cells.every(empty)) log(`| ${name} | ${cells.join(' | ')} |`);
  }
};

// S-top: a short first window, the reader at the top, a page landing mid-wheel. One row per case, one column per variant.
const S_CASES = [
  ['S-top-60', 'window=2, from the tail, -60 px steps'],
  ['S-top-300', 'window=2, from the tail, -300 px steps'],
  ['S-top-flick', 'window=2, from the tail, momentum flicks'],
  ['S-top-park-60', 'window=2, parked at 0, -60 px steps'],
  ['S-top-park-300', 'window=2, parked at 0, -300 px steps'],
  ['S-top-park-flick', 'window=2, parked at 0, momentum flicks'],
  ['S-top-real-60', 'real shape, -60 px steps'],
  ['S-top-real-300', 'real shape, -300 px steps'],
  ['S-top-real-flick', 'real shape, momentum flicks'],
];
function sTopTable(engine) {
  const rows = results.filter((r) => r.engine === engine && r.case.startsWith('S-top'));
  if (!rows.length) return;
  const vs = VARIANTS.filter((v) => rows.some((r) => r.variant === v));
  log(
    `\n### ${NAMES[engine]}: S-top (React build: ${[...new Set(rows.map((r) => r.react ?? 'unrecorded'))].join(' + ')})\n`,
  );
  log(`| Case | ${vs.join(' | ')} |\n| --- | ${vs.map(() => '---').join(' | ')} |`);
  for (const [id, label] of S_CASES) {
    const cells = vs.map((v) => {
      const runs = of(engine, v, id).filter((r) => r.case === id);
      if (!runs.length) return 'n/a';
      const x = runs.map((r) => r.result).filter((r) => r && r.loads !== undefined);
      if (!x.length) return `error ${runs.map((r) => r.error ?? r.result?.error ?? r.result?.skipped).join('; ')}`;
      // The ledger's own error on flicks (S-noise-flick) is the floor the residual is read against.
      const floor = id.endsWith('flick')
        ? Math.max(2, ...res(of(engine, 'v1', 'S-noise-flick')).map((n) => n.noise ?? 0))
        : 2;
      const jump = max(x.map((r) => r.jump));
      const end = max(x.map((r) => r.endResidual));
      const lost = x.reduce((a, r) => a + r.lostFrames, 0);
      const pinned = x.reduce((a, r) => a + r.pinned, 0);
      const gap = max(x.map((r) => r.gapJump));
      // An unmounted anchor (a virtualizer) cannot be followed; the distance to the bottom still can.
      const ok = (lost ? gap <= floor : jump <= floor && end <= floor) && !pinned;
      const loads = x.map((r) => r.loads).join('/');
      return verdict(
        ok,
        `jump ${fmt(jump)}, end ${fmt(end)}${lost ? `, anchor lost ${lost} fr (bottom gap ${fmt(gap)})` : ''}, pinned ${pinned}, loads ${loads}`,
      );
    });
    log(`| ${label} | ${cells.join(' | ')} |`);
  }
  const noise = vs.map((v) => {
    const cells = ['60', '300', 'flick'].map((k) => {
      const n = res(of(engine, v, `S-noise-${k}`));
      return n.length ? fmt(max(n.map((r) => r.noise ?? 0))) : 'n/a';
    });
    return `${v} ${cells.join('/')} px`;
  });
  log(`\nLedger noise floor (-60/-300/flick) (the same input, no page landing, per variant): ${noise.join('; ')}.`);
}

for (const engine of ENGINES) {
  if (!results.some((r) => r.engine === engine)) continue;
  const shown = VARIANTS.filter((v) =>
    results.some(
      (r) => r.engine === engine && r.variant === v && !r.case.startsWith('E-') && !r.case.startsWith('P6-tail'),
    ),
  );
  // Plain variants first; variants with options (`+progressive`, `+nopreserve`) get their own table.
  const plain = shown.filter((v) => !v.includes('+'));
  const optioned = shown.filter((v) => v.includes('+'));
  table(`${NAMES[engine]} (React build: ${buildOf(engine, plain)})`, { ...PROPS, ...OPEN_ROWS }, engine, plain);
  if (optioned.length)
    table(
      `${NAMES[engine]}, variants with options (React build: ${buildOf(engine, optioned)})`,
      { ...PROPS, ...OPEN_ROWS },
      engine,
      optioned,
    );

  // Tail-first mount scored to completion, and P1-P4 started while the slices still land.
  // Only the tail-first variants have slices landing. A plain variant's eager run only races its own mount.
  const progressive = VARIANTS.filter(
    (v) =>
      v.includes('progressive') &&
      results.some((r) => r.engine === engine && r.variant === v && r.case.startsWith('E-')),
  );
  const tails = results.filter((r) => r.engine === engine && r.case.startsWith('P6-tail') && r.ok && r.result);
  if (tails.length) {
    log(
      `\n#### ${NAMES[engine]}: tail-first mount scored to completion (React build: ${[...new Set(tails.map((t) => t.react ?? 'unrecorded'))].join(' + ')})\n`,
    );
    log(
      '| Variant | Window | Tail visible, ms | First slice, ms | Whole window in, ms | Longest first mount, ms | Longest slice, ms | Commits |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const v of [...new Set(tails.map((t) => t.variant))])
      for (const id of ['P6-tail', 'P6-tail-400']) {
        const rows = tails.filter((t) => t.variant === v && t.case === id);
        if (!rows.length) continue;
        const m = (f) => fmt(median(rows.map(f)));
        const mx = (f) => fmt(max(rows.map(f)));
        log(
          `| ${v} | ${id === 'P6-tail' ? '40 groups' : '400 groups'} | ${m((t) => t.boot.mountMs)} | ${m((t) => t.result.firstSliceMs)} | ${m((t) => t.result.fullWindowMs)} (max ${mx((t) => t.result.fullWindowMs)}) | ${m((t) => t.result.longestFirstMountMs)} | ${m((t) => t.result.longestSliceMs)} (max ${mx((t) => t.result.longestSliceMs)}) | ${m((t) => t.result.slices)} |`,
        );
      }
  }
  if (progressive.length)
    table(
      `${NAMES[engine]}: P1-P4 started while slices still land (React build: ${buildOf(engine, progressive)})`,
      props('E-'),
      engine,
      progressive,
    );

  sTopTable(engine);
  const failed = results.filter((r) => r.engine === engine && !r.ok);
  if (failed.length) log(`\nErrors: ${failed.map((r) => `${r.variant} ${r.case}: ${r.error}`).join('; ')}`);
}
