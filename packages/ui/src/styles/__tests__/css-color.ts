/**
 * A small CSS colour resolver for the contrast guardrail — enough of the value
 * grammar the v2 token layer actually uses, and nothing more.
 *
 * Supported: `oklch(L C H)`, `#rrggbb`, `rgb()/rgba()`, `var(--x)` indirection,
 * `color-mix(in oklch, A p%, B)` (including `transparent` as B, which is just an
 * alpha carrier), and the relative form `oklch(from <c> L calc(c * k) h)` that
 * `--bubble-tinted` uses.
 *
 * Verified against Chromium's own `getComputedStyle` for every token this file
 * resolves — the numbers are in the guardrail's header. Hand-rolling was the
 * cheaper option than a colour library in a node-environment test, but only
 * because the grammar is closed: a new value form here must be re-verified the
 * same way, never assumed.
 */

export type RGBA = { r: number; g: number; b: number; a: number };

export type Decls = Record<string, string>;

/** Parse every top-level rule into { selector -> { --token: value } }, comments stripped. */
export function parseRules(source: string): Map<string, Decls> {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = new Map<string, Decls>();
  let depth = 0;
  let buf = '';
  let selector = '';
  for (const ch of clean) {
    if (ch === '{') {
      if (depth === 0) selector = buf.split(';').pop()!.trim().replace(/\s+/g, ' ');
      depth += 1;
      if (depth === 1) buf = '';
      else buf += ch;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const decls: Decls = {};
        // Only top-level declarations of this rule; nested blocks keep their braces.
        for (const stmt of buf.replace(/\{[^{}]*\}/g, '').split(';')) {
          const m = stmt.match(/^\s*(--[a-z0-9-]+)\s*:\s*(.+?)\s*$/i);
          if (m) decls[m[1]!] = m[2]!.trim();
        }
        rules.set(selector, { ...(rules.get(selector) ?? {}), ...decls });
        buf = '';
      } else buf += ch;
      continue;
    }
    buf += ch;
  }
  return rules;
}

// ── OKLCH → sRGB ────────────────────────────────────────────────────────────

function gammaEncode(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(v * 255)));
}

function oklabToRgb(L: number, a: number, bb: number, alpha: number): RGBA {
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return {
    r: gammaEncode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: gammaEncode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: gammaEncode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: alpha,
  };
}

/** OKLCH in polar form — kept separate from RGBA so color-mix can interpolate in it. */
type OKLCH = { L: number; C: number; H: number; a: number };

function oklchToRgb({ L, C, H, a }: OKLCH): RGBA {
  const rad = (H * Math.PI) / 180;
  return oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad), a);
}

// ── Value grammar ───────────────────────────────────────────────────────────

const NUM = String.raw`[-\d.]+`;

/** Split a comma list at top level, ignoring commas inside nested parens. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Resolve a token to OKLCH. `lookup` supplies the cascade; `seen` breaks the
 * var() cycle a malformed sheet could introduce.
 */
export function resolveOklch(value: string, lookup: (token: string) => string, seen: Set<string> = new Set()): OKLCH {
  const v = value.trim();

  if (v === 'transparent') return { L: 0, C: 0, H: 0, a: 0 };

  const varRef = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (varRef) {
    const token = varRef[1]!;
    if (seen.has(token)) throw new Error(`var() cycle at ${token}`);
    return resolveOklch(lookup(token), lookup, new Set(seen).add(token));
  }

  // oklch(from <color> L C H) — relative colour syntax. `c` and `h` refer to the
  // origin's chroma and hue; only the forms the sheet uses are handled.
  const rel = v.match(/^oklch\(\s*from\s+(.+?)\s+(\S+)\s+(.+?)\s+(\S+)\s*\)$/i);
  if (rel) {
    const origin = resolveOklch(rel[1]!, lookup, seen);
    const L = channel(rel[2]!, origin, 'l');
    const C = channel(rel[3]!, origin, 'c');
    const H = channel(rel[4]!, origin, 'h');
    return { L, C, H, a: origin.a };
  }

  const oklch = v.match(new RegExp(String.raw`^oklch\(\s*(${NUM}%?)\s+(${NUM})\s+(${NUM})\s*\)$`, 'i'));
  if (oklch) {
    const raw = oklch[1]!;
    return {
      L: raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw),
      C: parseFloat(oklch[2]!),
      H: parseFloat(oklch[3]!),
      a: 1,
    };
  }

  const mix = v.match(/^color-mix\(\s*in\s+oklch\s*,\s*(.+)\)$/i);
  if (mix) return mixOklch(splitTop(mix[1]!), lookup, seen);

  return rgbToOklch(parseSrgb(v));
}

/** One channel of a relative colour: a literal, `l`/`c`/`h`, or `calc(<ch> * k)`. */
function channel(expr: string, origin: OKLCH, name: 'l' | 'c' | 'h'): number {
  const e = expr.trim();
  const own = { l: origin.L, c: origin.C, h: origin.H };
  if (e === name) return own[name];
  const calc = e.match(/^calc\(\s*([lch])\s*\*\s*([\d.]+)\s*\)$/i);
  if (calc) return own[calc[1]!.toLowerCase() as 'l' | 'c' | 'h'] * parseFloat(calc[2]!);
  const n = parseFloat(e);
  if (Number.isNaN(n)) throw new Error(`unsupported relative-colour channel: "${expr}"`);
  return n;
}

function mixOklch(parts: string[], lookup: (t: string) => string, seen: Set<string>): OKLCH {
  if (parts.length !== 2) throw new Error(`color-mix needs exactly two colours, got ${parts.length}`);
  const sides = parts.map((p) => {
    const m = p.match(new RegExp(String.raw`^(.*?)\s+(${NUM})%$`));
    return { color: (m ? m[1]! : p).trim(), pct: m ? parseFloat(m[2]!) / 100 : undefined };
  });
  // A single stated percentage implies the remainder for the other side.
  const p0 = sides[0]!.pct ?? (sides[1]!.pct !== undefined ? 1 - sides[1]!.pct : 0.5);
  const p1 = sides[1]!.pct ?? 1 - p0;
  const A = resolveOklch(sides[0]!.color, lookup, seen);
  const B = resolveOklch(sides[1]!.color, lookup, seen);

  // CSS premultiplies by alpha before interpolating, so mixing against
  // `transparent` carries only alpha through — the hue survives intact.
  const a = A.a * p0 + B.a * p1;
  if (a === 0) return { L: 0, C: 0, H: 0, a: 0 };
  const wA = (A.a * p0) / a;
  const wB = (B.a * p1) / a;

  // An achromatic side keeps its STATED hue in the interpolation: only the
  // `none` keyword makes a hue powerless, and `oklch(0.556 0 0)` states 0.
  // Chromium confirms — `color-mix(in oklch, destructive 55%, muted-foreground)`
  // resolves to hue 15.0287, i.e. 27.325 × 0.55, not destructive's 27.325.
  return {
    L: A.L * wA + B.L * wB,
    C: A.C * wA + B.C * wB,
    H: hueLerp(A.H, B.H, wB),
    a,
  };
}

/** Interpolate hue the short way round, as CSS `oklch` interpolation specifies. */
function hueLerp(h1: number, h2: number, t: number): number {
  let d = (((h2 - h1) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return (((h1 + d * t) % 360) + 360) % 360;
}

function parseSrgb(value: string): RGBA {
  const hex6 = value.match(/^#([0-9a-f]{6})$/i);
  if (hex6) {
    const n = parseInt(hex6[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const hex3 = value.match(/^#([0-9a-f]{3})$/i);
  if (hex3) {
    const [r, g, b] = [...hex3[1]!].map((c) => parseInt(c + c, 16));
    return { r: r!, g: g!, b: b!, a: 1 };
  }
  const rgba = value.match(
    new RegExp(String.raw`^rgba?\(\s*(${NUM})[\s,]+(${NUM})[\s,]+(${NUM})(?:[\s,/]+(${NUM}))?\s*\)$`, 'i'),
  );
  if (rgba) {
    return { r: +rgba[1]!, g: +rgba[2]!, b: +rgba[3]!, a: rgba[4] === undefined ? 1 : +rgba[4] };
  }
  throw new Error(`unsupported colour value: "${value}"`);
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function rgbToOklch({ r, g, b, a }: RGBA): OKLCH {
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360, a };
}

// ── Contrast ────────────────────────────────────────────────────────────────

export function toRgba(c: OKLCH): RGBA {
  return oklchToRgb(c);
}

/** Composite a (possibly translucent) colour over an opaque backdrop. */
export function composite(fg: RGBA, bg: RGBA): RGBA {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function relativeLuminance({ r, g, b }: RGBA): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrast(a: RGBA, b: RGBA): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)];
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
