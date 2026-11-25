// Runs in either page. Reads what an element paints, independent of how its markup is nested:
// its box (rect, fill, edges, radii, shadow) and, in reading order, the texts, icons and painted
// boxes inside it, placed relative to it. Two markups that paint the same compare equal.
window.__extract = (root, local = false) => {
  const probe = document.createElement('i');
  document.documentElement.append(probe);
  const rgba = (value) => {
    probe.style.color = 'rgba(0, 0, 0, 0)';
    probe.style.color = `color-mix(in srgb, ${value} 100%, transparent)`;
    const m = /color\(srgb ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)(?: \/ ([\d.e+-]+))?\)/.exec(getComputedStyle(probe).color);
    if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : +m[4]];
    const n = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).map(Number);
    return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
  };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const hex = (c) => `#${c.slice(0, 3).map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
  const opacityOf = (el) => {
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity;
    return o;
  };
  /** The opaque colour under an element: every ancestor's fill, painted in order. */
  const groundOf = (el) => {
    const chain = [];
    for (let e = el; e; e = e.parentElement) chain.unshift(e);
    let c = [255, 255, 255, 1];
    for (const e of chain) {
      const bg = rgba(getComputedStyle(e).backgroundColor);
      if (bg[3] > 0) c = over(bg, c);
    }
    return c;
  };
  const fade = (c, o) => [c[0], c[1], c[2], c[3] * o];
  const splitShadow = (v) => (v === 'none' ? [] : v.split(/,(?![^(]*\))/).map((s) => s.trim()));
  const shadows = (cs) =>
    splitShadow(cs.boxShadow)
      .map((s) => {
        const inset = /\binset\b/.test(s);
        const len = (s.match(/-?[\d.]+px/g) ?? []).map(parseFloat);
        const color = rgba(s.replace(/\binset\b/, '').replace(/-?[\d.]+px/g, '').trim());
        return { inset, x: len[0], y: len[1], blur: len[2], spread: len[3] ?? 0, color };
      })
      .filter((s) => s.color[3] > 0.0005 && (s.blur > 0 || s.spread !== 0 || s.x !== 0 || s.y !== 0));
  const round = (n) => Math.round(n * 100) / 100;
  const paint = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const o = opacityOf(el);
    const own = fade(rgba(cs.backgroundColor), o);
    const under = groundOf(el.parentElement ?? el);
    const fill = own[3] > 0.0005 ? hex(over(own, under)) : null;
    const base = own[3] > 0.0005 ? over(own, under) : under;
    const edges = {};
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const w = parseFloat(cs[`border${side}Width`]);
      const c = fade(rgba(cs[`border${side}Color`]), o);
      if (w > 0 && cs[`border${side}Style`] !== 'none' && c[3] > 0.0005) edges[side] = `${w}px ${hex(over(c, base))}`;
    }
    const drop = [];
    for (const s of shadows(cs)) {
      const c = fade(s.color, o);
      if (s.blur === 0 && s.x === 0 && s.y === 0 && s.spread > 0) {
        const v = `${s.spread}px ${hex(over(c, s.inset ? base : under))}`;
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) edges[side] = s.inset ? (edges[side] ?? v) : `${edges[side] ? `${edges[side]} + ` : ''}ring ${v}`;
      } else if (s.blur === 0 && s.inset && s.spread === 0) {
        if (s.x > 0) edges.Left ??= `${s.x}px ${hex(over(c, base))}`;
        if (s.x < 0) edges.Right ??= `${-s.x}px ${hex(over(c, base))}`;
        if (s.y > 0) edges.Top ??= `${s.y}px ${hex(over(c, base))}`;
        if (s.y < 0) edges.Bottom ??= `${-s.y}px ${hex(over(c, base))}`;
      } else drop.push(`${s.inset ? 'inset ' : ''}${s.x} ${s.y} ${s.blur} ${s.spread} ${hex([...s.color])}/${round(c[3])}`);
    }
    const ring = parseFloat(cs.outlineWidth);
    // A line on the element's own edge, however it is drawn.
    if (cs.outlineStyle !== 'none' && ring > 0 && parseFloat(cs.outlineOffset) === -ring)
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) edges[side] = `${ring}px ${hex(over(rgba(cs.outlineColor), base))}`;
    const outline = cs.outlineStyle !== 'none' && ring > 0 && parseFloat(cs.outlineOffset) !== -ring ? `${cs.outlineWidth} ${hex(over(rgba(cs.outlineColor), under))} offset ${cs.outlineOffset}` : null;
    const radius = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((k) => {
      const [a] = cs[`border${k}Radius`].split(' ');
      const px = a.endsWith('%') ? (parseFloat(a) / 100) * Math.min(r.width, r.height) : parseFloat(a);
      return round(Math.min(px, Math.min(r.width, r.height) / 2));
    });
    return { rect: [r.left, r.top, r.width, r.height].map(round), fill, edges, radius, shadow: drop.sort().join(', ') || null, outline };
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)') return false;
    const r = el.getBoundingClientRect();
    if (cs.overflow !== 'visible' && r.width <= 1 && r.height <= 1) return false;
    return opacityOf(el) > 0.02;
  };
  const clip = (el, rect, stop) => {
    let [l, t, r, b] = [rect.left, rect.top, rect.right, rect.bottom];
    for (let e = el; e && e !== stop.parentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const q = e.getBoundingClientRect();
      if (cs.overflowX !== 'visible') {
        l = Math.max(l, q.left);
        r = Math.min(r, q.right);
      }
      if (cs.overflowY !== 'visible') {
        t = Math.max(t, q.top);
        b = Math.min(b, q.bottom);
      }
    }
    return r - l < 0.5 || b - t < 0.5 ? null : { left: l, top: t, right: r, bottom: b };
  };
  const at = root.getBoundingClientRect();
  const rel = (r) => [r.left - at.left, r.top - at.top, r.right - r.left, r.bottom - r.top].map(round);
  /** The drawing itself, as points in a 24-unit box, so two sources of one Lucide glyph compare equal. */
  const glyphOf = (el) => {
    const ref = el.querySelector('use');
    const source = ref ? document.querySelector(ref.getAttribute('href')) : el;
    const vb = source?.viewBox?.baseVal;
    const k = 24 / (vb?.width || 24);
    const pts = [];
    for (const shape of source?.querySelectorAll('path,circle,rect,line,polyline,polygon,ellipse') ?? []) {
      if (shape.closest('mask,clipPath')) continue;
      const len = shape.getTotalLength();
      const turn = /rotate\(90 12 12\)/.test(shape.parentElement?.getAttribute('transform') ?? '');
      const n = Math.max(4, Math.round(len * k));
      for (let i = 0; i <= n; i++) {
        const q = shape.getPointAtLength((len * i) / n);
        const x = (q.x - (vb?.x ?? 0)) * k;
        const y = (q.y - (vb?.y ?? 0)) * k;
        pts.push(turn ? [24 - y, x] : [x, y]);
      }
    }
    return pts.map(([x, y]) => [round(x), round(y)]);
  };
  const texts = [];
  const icons = [];
  const boxes = [];
  /** Elements stacked on one rect paint one box. */
  const pushBox = (box) => {
    const same = boxes.find((b) => b.rect.every((v, i) => Math.abs(v - box.rect[i]) < 0.2));
    if (!same) return boxes.push(box);
    same.fill = box.fill ?? same.fill;
    same.edges = { ...same.edges, ...box.edges };
    same.shadow ??= box.shadow;
    same.outline ??= box.outline;
    if (box.radius.some((v) => v > 0)) same.radius = box.radius;
  };
  const textInk = (el) => {
    const cs = getComputedStyle(el);
    const o = opacityOf(el);
    return {
      color: hex(over(fade(rgba(cs.color), o), groundOf(el))),
      size: round(parseFloat(cs.fontSize)),
      weight: cs.fontWeight,
      family: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
      line: cs.lineHeight === 'normal' ? 'normal' : round(parseFloat(cs.lineHeight)),
      spacing: cs.letterSpacing === 'normal' ? 0 : round(parseFloat(cs.letterSpacing)),
      style: cs.fontStyle,
      numeric: cs.fontVariantNumeric,
      transform: cs.textTransform,
      deco: cs.textDecorationLine === 'none' ? '' : cs.textDecorationLine,
    };
  };
  const walk = (el, depth) => {
    if (!visible(el) || el.id === 'parity-probe') return;
    if (el instanceof SVGSVGElement) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || !clip(el.parentElement, r, root)) return;
      const cs = getComputedStyle(el);
      const o = opacityOf(el);
      const vb = el.viewBox.baseVal;
      const leaf = el.querySelector('path,circle,rect,line,polyline,polygon,use') ?? el;
      const ls = getComputedStyle(leaf);
      const ref = el.querySelector('use');
      const inner = ref ? (document.querySelector(ref.getAttribute('href'))?.firstElementChild ?? leaf) : leaf;
      const is = getComputedStyle(inner);
      const stroke = is.stroke === 'none' && cs.stroke !== 'none' ? cs.stroke : is.stroke;
      const strokeWidth = parseFloat(ref ? cs.strokeWidth : ls.strokeWidth);
      const unit = ref ? document.querySelector(ref.getAttribute('href'))?.viewBox?.baseVal : vb;
      const scale = unit?.width ? r.width / unit.width : 1;
      // A `use` paints its symbol's own children, which the page's rules for the icon's descendants don't reach.
      const still = is.vectorEffect === 'non-scaling-stroke';
      const ground = groundOf(el);
      const ink = (v) => (v === 'none' ? 'none' : hex(over(fade(rgba(v === 'currentcolor' ? cs.color : v), o), ground)));
      icons.push({
        rect: rel(r),
        stroke: stroke === 'none' ? 'none' : `${round(strokeWidth * (still ? 1 : scale))}px`,
        ink: stroke === 'none' ? ink(ls.fill) : ink(stroke),
        fill: ink(ref ? cs.fill : ls.fill) === 'none' ? 'none' : 'fill',
        glyph: glyphOf(el),
      });
      return;
    }
    if (el !== root) {
      const p = paint(el);
      if ((p.fill || Object.keys(p.edges).length || p.shadow) && p.rect[2] > 0.4 && p.rect[3] > 0.4) {
        const r = el.getBoundingClientRect();
        const under = hex(groundOf(el.parentElement));
        const seen = clip(el.parentElement, r, root);
        if (seen && !(p.fill === under && !Object.keys(p.edges).length && !p.shadow)) pushBox({ ...p, rect: rel(seen), tag: el.tagName.toLowerCase() });
      }
    }
    for (const pseudo of ['::before', '::after']) {
      const cs = getComputedStyle(el, pseudo);
      if (cs.content === 'none' || cs.content === 'normal' || cs.display === 'none') continue;
      const bg = rgba(cs.backgroundColor);
      const w = parseFloat(cs.width);
      const h = parseFloat(cs.height);
      if (bg[3] > 0.0005 && w > 0.4 && h > 0.4 && +cs.opacity > 0.02) {
        const q = el.getBoundingClientRect();
        const l = cs.position === 'absolute' ? q.left + el.clientLeft + (parseFloat(cs.left) || 0) : q.left;
        const t = cs.position === 'absolute' ? q.top + el.clientTop + (parseFloat(cs.top) || 0) : q.top;
        boxes.push({ rect: rel({ left: l, top: t, right: l + w, bottom: t + h }), fill: hex(over(fade(bg, opacityOf(el)), groundOf(el))), edges: {}, radius: [0, 0, 0, 0], shadow: null, outline: null, tag: pseudo });
      }
    }
    if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'range'].includes(el.type))) {
      const value = el.value || el.placeholder;
      // A field whose text a layer under it paints has transparent ink of its own.
      const ghost = el.value && rgba(getComputedStyle(el).color)[3] < 0.01;
      if (value && !ghost) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const ph = !el.value ? getComputedStyle(el, '::placeholder') : null;
        const ink = textInk(el);
        if (ph) ink.color = hex(over(fade(rgba(ph.color), +ph.opacity), groundOf(el)));
        const l = r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
        const t = r.top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
        const tall = el instanceof HTMLInputElement ? r.height - (t - r.top) - parseFloat(cs.paddingBottom) : parseFloat(cs.lineHeight);
        texts.push({ text: value, rect: [round(l - at.left), round(t - at.top), 0, round(tall)], field: true, cut: false, lines: 1, ...ink });
      }
      return;
    }
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        const parts = local && /^(pre|pre-wrap|pre-line|break-spaces)$/.test(getComputedStyle(el).whiteSpace)
          ? node.data.split('\n')
          : [node.data];
        let offset = 0;
        for (const part of parts) {
          const start = offset;
          offset += part.length + 1;
          const text = part.replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
          if (!text) continue;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + part.length);
          const rects = [...range.getClientRects()];
          if (!rects.length) continue;
          const full = range.getBoundingClientRect();
          const cut = clip(el, full, root);
          if (!cut) continue;
          texts.push({ text, lead: /^\s/.test(part), trail: /\s$/.test(part), rect: rel(cut), pre: /^(pre|pre-wrap|break-spaces)$/.test(getComputedStyle(el).whiteSpace), cut: full.right - cut.right > 0.6, lines: new Set(rects.map((r) => Math.round(r.top))).size, ...textInk(el) });
        }
      } else if (node.nodeType === 1) walk(node, depth + 1);
    }
  };
  walk(root, 0);
  // A run of text split over several nodes (React puts one per expression) reads as one.
  const merged = [];
  for (const t of texts) {
    const prev = merged[merged.length - 1];
    const same = prev && !prev.field && !t.field && prev.parentKey === t.parentKey && Math.abs(prev.rect[1] - t.rect[1]) < 1 && Math.abs(prev.rect[0] + prev.rect[2] - t.rect[0]) < (local && t.pre && prev.pre ? 8 : 6) && prev.color === t.color && prev.size === t.size && prev.weight === t.weight && prev.family === t.family && prev.style === t.style;
    if (same) {
      const gap = t.rect[0] - (prev.rect[0] + prev.rect[2]);
      prev.text += (gap > 1.5 || t.lead || prev.trail ? ' ' : '') + t.text;
      prev.trail = t.trail;
      prev.rect[2] = round(t.rect[0] + t.rect[2] - prev.rect[0]);
      prev.cut ||= t.cut;
    } else merged.push(t);
  }
  const out = { box: paint(root), texts: merged, icons, boxes, ground: hex(groundOf(root)) };
  probe.remove();
  return out;
};
