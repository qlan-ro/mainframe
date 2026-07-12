// Normalization + deep-diff. The two daemons legitimately differ on volatile
// data — timestamps, generated ids, durations, and their own data-dir paths —
// so we collapse ONLY those to placeholders before comparing. Everything else
// is a real wire divergence.

const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
// The strict wire invariant PORTING.md pins: Z + exactly 3 fractional digits.
// A timestamp-keyed value is collapsed ONLY when it matches this — a missing-
// millis `...00Z`, a `+00:00` offset, or an epoch number stays raw so deepDiff
// surfaces the format drift instead of silently equating both sides to `<TS>`.
const ISO8601_Z_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const NANOID = /^[A-Za-z0-9_-]{21}$/; // nanoid() default: 21 chars, url-safe alphabet
const GIT_SHA = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/; // full commit / tree SHAs
const TS_KEY = /(^|_)(created|updated|last_?opened|last_?seen|modified|timestamp)(_?at)?$/i;
const TS_KEY_CAMEL = /(createdAt|updatedAt|lastOpenedAt|lastSeenAt|lastSeen|modifiedAt|timestamp)$/;
const DUR_KEY = /(duration|elapsed|uptime|took|latency)(ms)?$/i;
const VER_KEY = /^version$/;
// The daemon's own OS process id (`/health` gained `pid: process.pid` in #442).
// The Node and Rust daemons are distinct processes, so their pids legitimately
// differ — an identity field, not wire logic — and collapse to a placeholder.
const PID_KEY = /^pid$/;
// nanoid file-id inside an attachment materialized path: `.../files/<21>-<name>`
const ATTACH_FILE_ID = /\/files\/[A-Za-z0-9_-]{21}-/g;

/** Build the per-daemon path replacements, longest `from` first. */
export function pathReplacements({ dataDir, roots }) {
  const list = [{ from: dataDir, to: '<DATADIR>' }];
  for (const [name, p] of Object.entries(roots)) list.push({ from: p, to: `<${name}>` });
  return list.sort((a, b) => b.from.length - a.from.length);
}

function scrubString(s, reps) {
  let out = s;
  for (const { from, to } of reps) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  out = out.replace(ATTACH_FILE_ID, '/files/<ID>-');
  if (ISO8601.test(out)) return '<TS>';
  if (NANOID.test(out)) return '<ID>';
  if (GIT_SHA.test(out)) return '<SHA>';
  return out;
}

/** Recursively replace volatile values with stable placeholders. */
export function normalize(value, reps, key) {
  if (typeof key === 'string') {
    if (TS_KEY.test(key) || TS_KEY_CAMEL.test(key)) {
      if (value === null || value === undefined) return value;
      // Collapse only a genuine Z+millis ISO string; keep anything else raw so a
      // timestamp-format regression is visible rather than masked as '<TS>'.
      if (typeof value === 'string' && ISO8601_Z_MILLIS.test(value)) return '<TS>';
      return value;
    }
    if (DUR_KEY.test(key) && typeof value === 'number') return '<DUR>';
    if (PID_KEY.test(key) && typeof value === 'number') return '<PID>';
    // Daemon build version: npm package version (Node) vs crate version (Rust)
    // legitimately differ — an environmental/cutover concern, not wire logic.
    if (VER_KEY.test(key) && typeof value === 'string') return '<VER>';
  }
  if (typeof value === 'string') return scrubString(value, reps);
  if (Array.isArray(value)) return value.map((v) => normalize(v, reps));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = normalize(value[k], reps, k);
    return out;
  }
  return value;
}

/**
 * First-divergence deep diff over already-normalized JSON. Returns null when
 * equal, else { path, a, b } describing the first mismatch (stable key order).
 */
export function deepDiff(a, b, path = '') {
  if (a === b) return null;
  const ta = kind(a);
  const tb = kind(b);
  if (ta !== tb) return { path: path || '(root)', a: preview(a), b: preview(b) };
  if (ta === 'array') {
    if (a.length !== b.length) {
      return { path: `${path}.length`, a: a.length, b: b.length };
    }
    for (let i = 0; i < a.length; i++) {
      const d = deepDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (ta === 'object') {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      if (!(k in a)) return { path: `${path}.${k}`, a: '(absent)', b: preview(b[k]) };
      if (!(k in b)) return { path: `${path}.${k}`, a: preview(a[k]), b: '(absent)' };
      const d = deepDiff(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return { path: path || '(root)', a: preview(a), b: preview(b) };
}

function kind(v) {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v === 'object' ? 'object' : typeof v;
}

function preview(v) {
  const s = JSON.stringify(v);
  if (s === undefined) return String(v);
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}
