#!/usr/bin/env node
/**
 * Guards the one v2 failure mode that is silent.
 *
 * v2 runs on the stock shadcn "Luma" token layer and imports none of the
 * shipped app's stylesheet, so every `mf-*` token and every named type rung
 * (`text-body`, `text-caption`, …) is undefined here. Tailwind emits nothing for
 * an undefined utility and the browser falls back to the inherited value, so a
 * component carrying one looks subtly wrong instead of failing — no build error,
 * no runtime error, nothing to grep for after the fact except the pixels.
 *
 *   node scripts/v2-lint.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const V2_DIR = fileURLToPath(new URL('../src/v2', import.meta.url));

const BANNED = [
  {
    pattern: /\btext-(micro|label|caption|body|heading|title|display|hero)\b/g,
    hint: 'named type rungs are gone — use the stock scale (text-xs … text-2xl)',
  },
  {
    pattern: /\b(?:bg|text|border|ring|fill|stroke|shadow|from|to|via)-mf-[a-z0-9-]+/g,
    hint: 'mf-* tokens live in the shipped stylesheet, which v2 does not import',
  },
  {
    pattern: /var\(--mf-[a-z0-9-]+\)/g,
    hint: '--mf-* variables are undefined in v2',
  },
];

// TS only. globals.css is where the token layer is defined and explained — it
// can't *use* a Tailwind class, so scanning it only ever finds its own prose.
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
    for (const { pattern, hint } of BANNED) {
      for (const match of line.matchAll(pattern)) {
        failures.push(`${relative(V2_DIR, path)}:${i + 1}  ${match[0]}  — ${hint}`);
      }
    }
  });
}

if (failures.length > 0) {
  console.error(`v2-lint: ${failures.length} use(s) of a token v2 does not define\n`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log('v2-lint: no undefined tokens in src/v2');
