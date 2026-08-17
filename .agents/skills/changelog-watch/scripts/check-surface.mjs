#!/usr/bin/env node
/**
 * Validates the citations in docs/research/adapters/{claude,codex}/CONSUMED-SURFACE.md:
 * every checklist row must name a Mainframe consumer, and every cited file and
 * symbol must still exist. Without this the checklists rot invisibly — a
 * renamed symbol leaves a row that reads as covered while nothing consumes it.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../../..');

const PAIRS = [
  { doc: 'docs/research/adapters/claude/CONSUMED-SURFACE.md', crate: 'packages/core-rs/crates/mainframe-adapter-claude' },
  { doc: 'docs/research/adapters/codex/CONSUMED-SURFACE.md', crate: 'packages/core-rs/crates/mainframe-adapter-codex' },
];

const ROW_RE = /^\|\s*((?:CLAUDE|CODEX)-[A-Z]+-\d+)\s*\|/;
// `packages/…` is repo-root relative; bare `src/…` and `tests/…` resolve inside
// the adapter crate. Match `tsx` before `ts` or the alternation truncates
// CodexTuningDefaults.tsx into a file that does not exist.
const CITATION_RE = /(?<![\w./-])((?:packages\/|src\/|tests\/)[\w./-]+\.(?:rs|tsx|ts))(?:::(?:\{([^}]*)\}|(\w+)))?/g;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== '--doc' && flag !== '--crate') throw new Error(`unknown flag: ${flag}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} expects a value`);
    args[flag === '--doc' ? 'doc' : 'crate'] = value;
  }
  if (Boolean(args.doc) !== Boolean(args.crate)) throw new Error('--doc and --crate must be given together');
  return args.doc ? [args] : PAIRS;
}

function citationsIn(cell) {
  const citations = [];
  for (const match of cell.matchAll(CITATION_RE)) {
    const [, file, braced, single] = match;
    const symbols = braced ? braced.split(',').map((s) => s.trim()) : [single].filter(Boolean);
    citations.push({ file, symbols: symbols.filter((s) => /^\w+$/.test(s)) });
  }
  return citations;
}

function resolveCitation(file, crateDir) {
  return file.startsWith('packages/') ? path.resolve(repoRoot, file) : path.resolve(crateDir, file);
}

async function readSource(filePath, cache) {
  if (!cache.has(filePath)) {
    cache.set(
      filePath,
      readFile(filePath, 'utf8').catch((err) => {
        if (err.code === 'ENOENT') return null;
        throw err;
      }),
    );
  }
  return cache.get(filePath);
}

async function checkRow(row, crateDir, cache) {
  const citations = citationsIn(row.line);
  if (citations.length === 0) return [`NO CITATION (row ${row.id}) — name the consumer as file::symbol`];
  const problems = [];
  for (const { file, symbols } of citations) {
    const resolved = resolveCitation(file, crateDir);
    const source = await readSource(resolved, cache);
    if (source === null) {
      problems.push(`MISSING FILE ${resolved} (row ${row.id})`);
      continue;
    }
    for (const symbol of symbols) {
      if (!new RegExp(`\\b${symbol}\\b`).test(source)) {
        problems.push(`MISSING SYMBOL ${resolved}::${symbol} (row ${row.id})`);
      }
    }
  }
  return problems;
}

async function checkPair({ doc, crate }) {
  const docPath = path.resolve(repoRoot, doc);
  const crateDir = path.resolve(repoRoot, crate);
  const label = path.isAbsolute(doc) ? doc : path.relative(repoRoot, docPath);
  const rows = (await readFile(docPath, 'utf8'))
    .split('\n')
    .map((line) => ({ line, id: ROW_RE.exec(line)?.[1] }))
    .filter((row) => row.id);
  if (rows.length === 0) {
    return { label, problems: [`NO ROWS matched the checklist schema in ${label} — the table format changed`] };
  }
  const cache = new Map();
  const problems = [];
  for (const row of rows) problems.push(...(await checkRow(row, crateDir, cache)));
  return { label, rows: rows.length, problems };
}

async function main() {
  let failed = false;
  for (const pair of parseArgs(process.argv.slice(2))) {
    const { label, rows, problems } = await checkPair(pair);
    if (problems.length === 0) {
      console.log(`${label}: OK (${rows} rows)`);
      continue;
    }
    failed = true;
    for (const problem of problems) console.error(`${label}: ${problem}`);
  }
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
