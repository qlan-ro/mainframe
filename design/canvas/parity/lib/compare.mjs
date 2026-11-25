// Two extractions of one element, as rows of differences.
const TOL = 0.5;
const near = (a, b, tol = TOL) => Math.abs(a - b) < tol;
const norm = (s) => s.toLowerCase().replace(/[\s…]+/g, ' ').trim();
const r = (n) => Math.round(n * 100) / 100;

function pairTexts(a, b, exact) {
  const left = [...b];
  const pairs = [];
  const rest = [];
  for (const t of a) {
    const i = left.findIndex((u) => norm(u.text) === norm(t.text));
    if (i >= 0) pairs.push([t, left.splice(i, 1)[0]]);
    else rest.push(t);
  }
  // Different strings in the same place are the same element with other content.
  for (const t of rest) {
    let best = -1;
    let score = 60;
    if (!exact) left.forEach((u, i) => {
      const d = Math.abs(u.rect[0] - t.rect[0]) + Math.abs(u.rect[1] - t.rect[1]) * 2;
      if (d < score) [best, score] = [i, d];
    });
    pairs.push([t, best >= 0 ? left.splice(best, 1)[0] : null]);
  }
  for (const u of left) pairs.push([null, u]);
  return pairs;
}

function pairPlaced(a, b, reach) {
  const left = [...b];
  const pairs = [];
  for (const t of a) {
    let best = -1;
    let score = reach;
    left.forEach((u, i) => {
      const cx = Math.abs(u.rect[0] + u.rect[2] / 2 - t.rect[0] - t.rect[2] / 2);
      const cy = Math.abs(u.rect[1] + u.rect[3] / 2 - t.rect[1] - t.rect[3] / 2);
      const d = cx + cy + (Math.abs(u.rect[2] - t.rect[2]) + Math.abs(u.rect[3] - t.rect[3])) / 3;
      if (d < score) [best, score] = [i, d];
    });
    pairs.push([t, best >= 0 ? left.splice(best, 1)[0] : null]);
  }
  for (const u of left) pairs.push([null, u]);
  return pairs;
}

const spread = (a, b) => {
  if (!a.length || !b.length) return a.length === b.length ? 0 : 24;
  let worst = 0;
  let sum = 0;
  for (const [x, y] of a) {
    let d = Infinity;
    for (const [u, v] of b) d = Math.min(d, (x - u) ** 2 + (y - v) ** 2);
    d = Math.sqrt(d);
    worst = Math.max(worst, d);
    sum += d;
  }
  return Math.max(sum / a.length, worst / 3);
};
/** How far two glyphs are apart, in units of a 24-unit icon. */
const glyphGap = (a, b) => Math.max(spread(a, b), spread(b, a));

/** A ring outside a box and a border inside a larger one paint the same: name both by the outer edge. */
function outer(box) {
  const m = /^ring ([\d.]+)px (#\w+)$/.exec(box.edges.Top ?? '');
  if (!m || ['Right', 'Bottom', 'Left'].some((k) => box.edges[k] !== box.edges.Top)) return box;
  const w = +m[1];
  const [x, y, width, height] = box.rect;
  return { ...box, rect: [x - w, y - w, width + 2 * w, height + 2 * w], radius: box.radius.map((v) => (v ? v + w : 0)), edges: Object.fromEntries(Object.keys(box.edges).map((k) => [k, `${w}px ${m[2]}`])) };
}

export function compare(p, a, opt = {}) {
  p = { ...p, boxes: p.boxes.map(outer) };
  a = { ...a, boxes: a.boxes.map(outer) };
  const rows = [];
  let checks = 0;
  const row = (part, prop, proto, app) => rows.push({ part, prop, proto: String(proto), app: String(app) });
  const geo = (part, names, x, y) => names.forEach((n, i) => n && !near(x[i], y[i]) && row(part, n, r(x[i]), r(y[i])));
  const painted = (part, x, y, withRect) => {
    checks += 8 + (withRect?.length ?? 0);
    if (withRect) geo(part, withRect, x.rect, y.rect);
    if ((x.fill ?? 'none') !== (y.fill ?? 'none') && !(opt.ground && false)) row(part, 'fill', x.fill ?? 'none', y.fill ?? 'none');
    for (const side of ['Top', 'Right', 'Bottom', 'Left'])
      if ((x.edges[side] ?? 'none') !== (y.edges[side] ?? 'none')) row(part, `border ${side.toLowerCase()}`, x.edges[side] ?? 'none', y.edges[side] ?? 'none');
    const shows = (q) => q.fill || Object.keys(q.edges).length || q.shadow;
    if (shows(x) && shows(y) && x.radius.some((v, i) => !near(v, y.radius[i]))) row(part, 'radius', x.radius.join('/'), y.radius.join('/'));
    if (x.shadow !== y.shadow) row(part, 'shadow', x.shadow ?? 'none', y.shadow ?? 'none');
    if (x.outline !== y.outline) row(part, 'focus outline', x.outline ?? 'none', y.outline ?? 'none');
  };
  if (opt.only !== 'inner') painted('box', p.box, a.box, opt.noBox ? null : (opt.box ?? ['x', 'y', 'width', 'height']));
  if (opt.only === 'box') return { rows: rows.filter((x) => !(x.prop === 'fill' && p.ground === a.ground)), checks };
  // Fills: compare what is seen, so a transparent box over the right ground is not a difference.
  for (const item of rows) if (item.part === 'box' && item.prop === 'fill' && p.ground === a.ground) item.drop = true;
  for (const [t, u] of pairTexts(p.texts, a.texts, opt.exactText)) {
    const name = `text “${(t ?? u).text.slice(0, 48)}”`;
    if (!t || !u) {
      row(name, t ? 'missing in app' : 'only in app', t ? 'shown' : 'absent', u ? 'shown' : 'absent');
      continue;
    }
    checks += 14;
    const other = norm(t.text) !== norm(u.text);
    if (other) row(name, 'content', t.text.slice(0, 60), u.text.slice(0, 60));
    const right = opt.endAligned?.(t);
    if (right) {
      if (!near(t.rect[0] + t.rect[2], u.rect[0] + u.rect[2])) row(name, 'right edge', r(t.rect[0] + t.rect[2]), r(u.rect[0] + u.rect[2]));
    } else if (!near(t.rect[0], u.rect[0])) row(name, 'x', t.rect[0], u.rect[0]);
    // The middle of the glyph box, so a font size difference is not reported twice.
    if (t.lines === u.lines && !near(t.rect[1] + t.rect[3] / 2, u.rect[1] + u.rect[3] / 2)) row(name, 'y (middle)', r(t.rect[1] + t.rect[3] / 2), r(u.rect[1] + u.rect[3] / 2));
    if (!other && !t.cut && !u.cut && !t.field && !u.field && !near(t.rect[2], u.rect[2])) row(name, 'width', t.rect[2], u.rect[2]);
    if (!other && Boolean(t.cut) !== Boolean(u.cut)) row(name, 'truncated', t.cut ? `yes, ${t.rect[2]} px` : 'no', u.cut ? `yes, ${u.rect[2]} px` : 'no');
    if (!other && t.cut && u.cut && !near(t.rect[2], u.rect[2])) row(name, 'visible width', t.rect[2], u.rect[2]);
    if (!other && (t.lines ?? 1) !== (u.lines ?? 1)) row(name, 'lines', t.lines, u.lines);
    if (Math.abs(t.size - u.size) > 0.1) row(name, 'size', t.size, u.size);
    for (const k of ['weight', 'family', 'spacing', 'style', 'transform', 'deco', 'color']) if (String(t[k]) !== String(u[k])) row(name, k, t[k], u[k]);
    // One line of text shows its line height only through its place, which is compared above.
    if ((t.lines ?? 1) > 1 && (u.lines ?? 1) > 1 && t.line !== u.line) row(name, 'line height', t.line, u.line);
    const tab = (v) => v.includes('tabular-nums');
    if (/\d/.test(t.text) && tab(t.numeric) !== tab(u.numeric)) row(name, 'numerals', t.numeric, u.numeric);
  }
  pairPlaced(p.icons, a.icons, opt.reach ?? 40).forEach(([t, u], i) => {
    const name = `icon ${i + 1}`;
    if (!t || !u) {
      const at = (t ?? u).rect;
      row(`${name} at ${at[0]},${at[1]} ${at[2]}×${at[3]}`, t ? 'missing in app' : 'only in app', t ? 'shown' : 'absent', u ? 'shown' : 'absent');
      return;
    }
    checks += 8;
    geo(name, ['x', 'y', 'width', 'height'], t.rect, u.rect);
    if (t.stroke !== u.stroke && !near(parseFloat(t.stroke) || 0, parseFloat(u.stroke) || 0, 0.1)) row(name, 'stroke', t.stroke, u.stroke);
    if (glyphGap(t.glyph, u.glyph) > 0.5) row(name, 'glyph', `${t.glyph.length} points`, `${u.glyph.length} points, ${r(glyphGap(t.glyph, u.glyph))} units apart`);
    if (t.ink !== u.ink) row(name, 'colour', t.ink, u.ink);
    if (t.fill !== u.fill) row(name, 'filled', t.fill, u.fill);
  });
  pairPlaced(p.boxes, a.boxes, opt.reach ?? 40).forEach(([t, u], i) => {
    const name = `inner box ${i + 1}`;
    if (!t || !u) {
      const q = t ?? u;
      row(`${name} (${q.tag}) at ${q.rect[0]},${q.rect[1]} ${q.rect[2]}×${q.rect[3]}`, t ? 'missing in app' : 'only in app', t ? `${t.fill} ${JSON.stringify(t.edges)}` : 'absent', u ? `${u.fill} ${JSON.stringify(u.edges)}` : 'absent');
      return;
    }
    painted(name, t, u, ['x', 'y', 'width', 'height']);
  });
  return { rows: rows.filter((x) => !x.drop), checks };
}
