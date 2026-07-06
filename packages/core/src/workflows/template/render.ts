// packages/core/src/workflows/template/render.ts
import jsonata from 'jsonata';

export class TemplateError extends Error {}

const EXPR_RE = /\$\{([\s\S]+?)\}/g;

function wholeExpr(s: string): string | null {
  const m = /^\s*\$\{([\s\S]+)\}\s*$/.exec(s);
  if (!m) return null;
  // Reject strings like "${a} and ${b}" (two expressions)
  const inner = m[1] ?? '';
  return inner.includes('${') ? null : inner;
}

/** Walk a jsonata AST collecting root path names. */
function collectRoots(node: unknown, out: Set<string>): void {
  if (node === null || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  if (n['type'] === 'path' && Array.isArray(n['steps'])) {
    const first = n['steps'][0] as Record<string, unknown> | undefined;
    if (first && first['type'] === 'name' && typeof first['value'] === 'string') out.add(first['value']);
  }
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) v.forEach((c) => collectRoots(c, out));
    else if (v && typeof v === 'object') collectRoots(v, out);
  }
}

export function extractRefRoots(template: string): string[] {
  const roots = new Set<string>();
  for (const m of template.matchAll(EXPR_RE)) {
    try {
      collectRoots(jsonata(m[1] ?? '').ast(), roots);
    } catch {
      /* expected: verifier reports syntax errors with position context */
    }
  }
  return [...roots];
}

const BUILTIN_ROOTS = new Set(['inputs', 'vars', 'trigger', 'run', 'item', 'index']);

async function evalExpr(expr: string, scope: Record<string, unknown>): Promise<unknown> {
  const roots = new Set<string>();
  let compiled: jsonata.Expression;
  try {
    compiled = jsonata(expr);
    collectRoots(compiled.ast(), roots);
  } catch (err) {
    throw new TemplateError(`invalid expression '${expr}': ${String(err)}`);
  }
  for (const root of roots) {
    if (!(root in scope) && !BUILTIN_ROOTS.has(root) && !root.startsWith('$')) {
      throw new TemplateError(`unknown reference '${root}' in '${expr}' — step not in scope or never ran`);
    }
  }
  try {
    return await compiled.evaluate(scope);
  } catch (err) {
    throw new TemplateError(`failed to evaluate '${expr}': ${String(err)}`);
  }
}

export async function renderValue(value: unknown, scope: Record<string, unknown>): Promise<unknown> {
  if (typeof value === 'string') {
    const whole = wholeExpr(value);
    if (whole !== null) return evalExpr(whole, scope);
    let out = '';
    let last = 0;
    for (const m of value.matchAll(EXPR_RE)) {
      out += value.slice(last, m.index);
      const v = await evalExpr(m[1] ?? '', scope);
      out += typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v);
      last = (m.index ?? 0) + m[0].length;
    }
    return out + value.slice(last);
  }
  if (Array.isArray(value)) return Promise.all(value.map((v) => renderValue(v, scope)));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await renderValue(v, scope);
    return out;
  }
  return value;
}

/** Render a condition expression to a boolean. */
export async function renderCondition(expr: string, scope: Record<string, unknown>): Promise<boolean> {
  const whole = wholeExpr(expr) ?? expr;
  return Boolean(await evalExpr(whole, scope));
}
