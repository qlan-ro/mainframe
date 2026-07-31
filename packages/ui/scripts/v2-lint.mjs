#!/usr/bin/env node
/**
 * Guards the one v2 failure mode that is silent.
 *
 * `text-micro` and `text-label` don't exist in the v2 token layer. Tailwind
 * emits nothing for an undefined font-size utility and the browser renders the
 * inherited size, so a shipped component carrying one looks subtly wrong instead
 * of failing — no build error, no runtime error, nothing to grep for after the
 * fact except the pixels.
 *
 *   node scripts/v2-lint.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const V2_DIR = fileURLToPath(new URL('../src/v2', import.meta.url));
const DEAD_RUNGS = /\btext-(micro|label)\b/g;
// TS only. globals.css is where the rungs are deleted and explained — it can't
// *use* a Tailwind class, so scanning it only ever finds its own prose.
const SOURCE = /\.tsx?$/;
const COMMENT = /^\s*(\/\/|\/\*|\*)/;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (SOURCE.test(entry.name)) yield path;
  }
}

const failures = [];
for await (const path of walk(V2_DIR)) {
  const text = await readFile(path, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (COMMENT.test(line)) return;
    for (const match of line.matchAll(DEAD_RUNGS)) {
      failures.push(`${relative(V2_DIR, path)}:${i + 1}  ${match[0]}`);
    }
  });
}

if (failures.length > 0) {
  console.error(`v2-lint: ${failures.length} use(s) of a deleted type rung\n`);
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('\ntext-micro and text-label are not defined in v2. Use text-caption or text-body.');
  process.exit(1);
}

console.log('v2-lint: no deleted type rungs in src/v2');
