#!/usr/bin/env node
// diffd — the Phase-3 differential harness (daemon-rust-port plan §9).
//
// Boots the Node daemon and the Rust daemon side-by-side, each on its own
// byte-copy of a Node-seeded data dir, replays the Phase-3 route matrix against
// both, normalizes volatile fields (timestamps, ids, durations, paths), and
// deep-diffs response bodies + status codes + the post-run SQLite rows. Writes
// docs/rust-port/DIFF-REPORT-phase3.md and prints totals.
//
// Env hygiene: temp dirs only (never ~/.mainframe), ephemeral ports, both
// daemons killed on exit. Node build failure falls back to the prebuilt dist.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Daemon } from './lib/daemon.mjs';
import { buildMatrix } from './lib/matrix.mjs';
import { deepDiff, normalize, pathReplacements } from './lib/normalize.mjs';
import { buildSeed } from './lib/seed.mjs';
import { dumpTables } from './lib/sqlite.mjs';
import { freePort, req } from './lib/util.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../../..');
const RUST_DIR = path.join(REPO_ROOT, 'packages', 'core-rs');
const NODE_DIST = path.join(REPO_ROOT, 'packages', 'core', 'dist', 'index.js');
const RUST_BIN = path.join(RUST_DIR, 'target', 'debug', 'mainframe-daemon');
const REPORT = path.join(REPO_ROOT, 'docs', 'rust-port', 'DIFF-REPORT-phase3.md');

const blockers = [];
const skipped = [];
const cleanups = [];

// Divergences whose cause is understood: either the documented Phase-4/5 seam
// or a systematic deviation to resolve uniformly (not piecemeal here). Keyed by
// route id / `table:rowKey`; presence downgrades DIVERGENT → the tagged verdict.
const KNOWN_ROUTE = {
  'settings-providers':
    'EXPECTED(phase4): `resolvedExecutable` enrichment is the documented Phase-4/5 adapter-registry seam (get_providers PORT STATUS note). Rust omits the field until adapter probing lands.',
  'projects-delete':
    'EXPECTED(phase4): DELETE /api/projects/:id calls ChatManager.removeProject (stop live sessions + tear down worktrees) before deleting the row. ChatManager is the Phase-4/5 seam, so Rust returns the failure-path 500 and never removes the row; Node returns 200 and deletes it.',
};
// Understood DB-row divergences. Matched by predicate because the exact key is
// host-dependent (which adapter resolves varies with the installed toolchain).
function classifyDb(table, key, kind) {
  if (table === 'settings' && /^provider\.[^.]+\.executablePath$/.test(key) && kind === 'only-node') {
    return 'EXPECTED(phase4): Node persists resolved adapter executable paths (resolveAdapterExecutableCached side-effect); Rust adapter probing is Phase-4, so the row is never written. The specific adapter/key and row count vary with the host toolchain.';
  }
  if (table === 'projects' && kind === 'only-rust') {
    return 'EXPECTED(phase4): the projects-delete probe removes the throwaway project via ChatManager.removeProject (Node 200). Rust returns the Phase-4/5 seam 500 and keeps the row, so the deleted project survives only on the Rust side.';
  }
  return null;
}

function onExit() {
  for (const fn of cleanups.splice(0)) {
    try {
      fn();
    } catch {
      /* best effort */
    }
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (onExit(), process.exit(130)));

function buildNodeDaemon() {
  try {
    execFileSync('pnpm', ['--filter', '@qlan-ro/mainframe-types', 'build'], { cwd: REPO_ROOT, stdio: 'pipe' });
    execFileSync('pnpm', ['--filter', '@qlan-ro/mainframe-core', 'build'], { cwd: REPO_ROOT, stdio: 'pipe' });
  } catch (e) {
    const detail = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
    if (!fs.existsSync(NODE_DIST)) {
      blockers.push(`Node build failed and no prebuilt dist exists: ${detail.trim().split('\n').slice(-3).join(' ')}`);
      throw new Error('cannot obtain a Node daemon build');
    }
    blockers.push(
      'Node daemon build (`pnpm --filter @qlan-ro/mainframe-core build`) fails on pre-existing read-only source: ' +
        'src/db/migrations.ts:237 `TS2532 Object is possibly undefined` under tsconfig.base.json (noUncheckedIndexedAccess). ' +
        'Fell back to the prebuilt packages/core/dist/index.js (fresh, boots cleanly). Not a Rust-port defect; TS fix is out of scope.',
    );
  }
  return { cmd: process.execPath, args: [NODE_DIST], cwd: REPO_ROOT };
}

function buildRustDaemon() {
  execFileSync('cargo', ['build', '-p', 'mainframe-daemon'], { cwd: RUST_DIR, stdio: 'pipe' });
  return { cmd: RUST_BIN, args: [], cwd: RUST_DIR };
}

async function runMatrix(baseUrl, matrix) {
  const results = {};
  for (const step of matrix) {
    const p = typeof step.path === 'function' ? step.path(results) : step.path;
    results[step.id] = await req(baseUrl, step.method, p, { body: step.body, query: step.query });
  }
  return results;
}

async function runPhase(kind, cmd, dataDir, logPath) {
  const port = await freePort();
  const daemon = new Daemon({ kind, cmd: cmd.cmd, args: cmd.args, dataDir, port, logPath, cwd: cmd.cwd });
  await daemon.start();
  const matrix = buildMatrix(MANIFEST);
  const results = await runMatrix(daemon.baseUrl, matrix);
  await daemon.stop();
  return { results, tables: dumpTables(dataDir) };
}

let MANIFEST;

async function main() {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'diffd-'));
  cleanups.push(() => fs.rmSync(workRoot, { recursive: true, force: true }));

  const nodeCmd = buildNodeDaemon();
  const rustCmd = buildRustDaemon();

  const { seedDir, manifest, projDir } = await buildSeed(workRoot, nodeCmd);
  MANIFEST = manifest;
  if (!manifest.chatIds.length) blockers.push('Seed produced no chats — chat-scoped probes degraded.');

  // Pristine snapshot of the external project dirs (dirty tree included) so the
  // Rust phase starts from the exact state the Node phase did.
  const projBackup = path.join(workRoot, 'proj-backup');
  fs.cpSync(projDir, projBackup, { recursive: true });
  const restoreProj = () => {
    fs.rmSync(projDir, { recursive: true, force: true });
    fs.cpSync(projBackup, projDir, { recursive: true });
  };

  const nodeDir = path.join(workRoot, 'node');
  const rustDir = path.join(workRoot, 'rust');
  fs.cpSync(seedDir, nodeDir, { recursive: true });
  fs.cpSync(seedDir, rustDir, { recursive: true });

  const nodePhase = await runPhase('node', nodeCmd, nodeDir, path.join(workRoot, 'node-daemon.log'));
  restoreProj();
  const rustPhase = await runPhase('rust', rustCmd, rustDir, path.join(workRoot, 'rust-daemon.log'));

  skipped.push(
    'Phase-4/5 route groups are out of scope and not mounted in the Rust daemon (per the phase guard): chats CRUD, chat-commands, context, worktree, launch, external-sessions, background-tasks, adapters/agents/skills, lsp, tunnel, workflows, workflow-admin, and the plugins mount.',
    'WS chat handlers (message.send / permission.respond) — Phase-4/5.',
    'files-list ordering is compared as a set: raw directory-walk order is runtime/OS-dependent (Node recursion vs Rust stack) and unspecified by the contract; the file SET matches.',
    'git-write remote ops (fetch, pull, push) are not probed: they require a live upstream remote, which the seed repo has none of — the result is non-deterministic (network/remote state) rather than a wire-parity question.',
    'git-write merge / rebase / abort are not probed: each needs a hand-built divergent/conflicted branch state to exercise meaningfully; without it both daemons short-circuit identically and the probe asserts nothing. git-write update-all fans out over the same remote ops.',
    'git-chat commit / push are not probed for parity: a real commit embeds the wall-clock author/committer time, which differs between the sequential Node and Rust phases (distinct SHAs/dates) and is not a wire divergence; push additionally needs a remote. status / stage / unstage / diff-since-main (deterministic, read/index-only) ARE probed.',
    'DELETE /api/projects/:id IS probed (projects-delete) and classified EXPECTED(phase4): it is the ChatManager.removeProject seam — Node removes the row (200), Rust returns the seam 500 (row kept).',
  );
  const report = compare(nodePhase, rustPhase, { nodeDir, rustDir, workRoot });
  writeReport(report);
  onExit();
  printTotals(report);
}

function compare(nodePhase, rustPhase, dirs) {
  const nReps = pathReplacements({ dataDir: dirs.nodeDir, roots: { ROOT: dirs.workRoot } });
  const rReps = pathReplacements({ dataDir: dirs.rustDir, roots: { ROOT: dirs.workRoot } });
  const matrix = buildMatrix(MANIFEST);
  const rows = [];
  for (const step of matrix) {
    const a = nodePhase.results[step.id];
    const b = rustPhase.results[step.id];
    const na = { status: a.status, body: normalize(a.body, nReps) };
    const nb = { status: b.status, body: normalize(b.body, rReps) };
    if (step.unordered) {
      sortData(na.body);
      sortData(nb.body);
    }
    let verdict = 'IDENTICAL';
    let detail = '';
    if (a.status !== b.status) {
      verdict = 'DIVERGENT';
      detail = `status ${a.status} → ${b.status}`;
      if (b.status === 404 && a.status === 200) verdict = 'DIVERGENT(unmounted?)';
    } else {
      const d = deepDiff(na.body, nb.body);
      if (d) {
        verdict = 'DIVERGENT';
        detail = `${d.path}: ${JSON.stringify(d.a)} → ${JSON.stringify(d.b)}`;
      }
    }
    if (verdict !== 'IDENTICAL' && KNOWN_ROUTE[step.id]) {
      verdict = KNOWN_ROUTE[step.id].split(':')[0];
      detail = `${detail} — ${KNOWN_ROUTE[step.id]}`;
    }
    rows.push({ id: step.id, cat: step.cat, method: step.method, status: `${a.status}/${b.status}`, verdict, detail });
  }
  const dbRows = compareTables(nodePhase.tables, rustPhase.tables, nReps, rReps);
  return { rows, dbRows };
}

// Composite primary key per table so rows align across the two data dirs even
// when counts differ — pinpoints the exact key/field that diverged.
const ROW_KEY = {
  settings: (r) => `${r.category}.${r.key}`,
  chat_tags: (r) => `${r.chat_id}|${r.tag}|${r.source}`,
  tags: (r) => r.name,
  projects: (r) => r.id,
  chats: (r) => r.id,
  devices: (r) => r.device_id,
};

function keyRows(table, list, reps) {
  const keyOf = ROW_KEY[table] ?? ((r, i) => String(i));
  const map = {};
  list.forEach((r, i) => (map[keyOf(r, i)] = normalize(r, reps)));
  return map;
}

/** Sort an envelope's `data` array in place for order-insensitive routes. */
function sortData(body) {
  const arr = body?.data;
  if (Array.isArray(arr)) arr.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
}

function compareTables(nt, rt, nReps, rReps) {
  const rows = [];
  const tables = [...new Set([...Object.keys(nt), ...Object.keys(rt)])].sort();
  for (const t of tables) {
    const na = keyRows(t, nt[t] ?? [], nReps);
    const nb = keyRows(t, rt[t] ?? [], rReps);
    const keys = [...new Set([...Object.keys(na), ...Object.keys(nb)])].sort();
    let detail = '';
    let verdict = 'IDENTICAL';
    for (const k of keys) {
      let d = '';
      let kind = 'field';
      if (!(k in na)) (d = `row [${k}] only in rust`), (kind = 'only-rust');
      else if (!(k in nb)) (d = `row [${k}] only in node`), (kind = 'only-node');
      else {
        const diff = deepDiff(na[k], nb[k]);
        if (diff) d = `[${k}]${diff.path}: ${JSON.stringify(diff.a)} → ${JSON.stringify(diff.b)}`;
      }
      if (!d) continue;
      const known = classifyDb(t, k, kind);
      detail = known ? `${d} — ${known}` : d;
      verdict = known ? known.split(':')[0] : 'DIVERGENT';
      if (!known) break; // an unexplained divergence dominates the row's verdict
    }
    rows.push({ table: t, rows: `${(nt[t] ?? []).length}/${(rt[t] ?? []).length}`, verdict, detail });
  }
  return rows;
}

const isReal = (v) => v.startsWith('DIVERGENT');

function writeReport({ rows, dbRows }) {
  const identical = rows.filter((r) => r.verdict === 'IDENTICAL').length;
  const expected = rows.filter((r) => r.verdict.startsWith('EXPECTED')).length;
  const deviation = rows.filter((r) => r.verdict.startsWith('DEVIATION')).length;
  const real = rows.filter((r) => isReal(r.verdict));
  const esc = (s) => String(s).replace(/\|/g, '\\|');
  const lines = [];
  lines.push('# Phase-3 Differential Report (Node vs Rust daemon)', '');
  lines.push(`Generated by \`packages/core-rs/tools/diffd/diffd.mjs\`. Routes compared: ${rows.length}. ` +
    `Identical: ${identical}. Expected Phase-4 gaps: ${expected}. Known deviations: ${deviation}. ` +
    `Unexplained divergences: ${real.length}.`, '');
  lines.push('Verdicts: **IDENTICAL** (byte-equal after normalizing timestamps / ids / durations / paths / SHAs), ' +
    '**EXPECTED** (documented Phase-4/5 seam), **DEVIATION** (understood, resolve uniformly), ' +
    '**DIVERGENT** (unexplained — needs a fix).', '');
  if (blockers.length) {
    lines.push('## Blockers', '');
    for (const b of blockers) lines.push(`- ${b}`);
    lines.push('');
  }
  lines.push('## Routes', '', '| Route | Method | Status (node/rust) | Verdict | First divergence |', '|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.id} | ${r.method} | ${r.status} | ${r.verdict} | ${esc(r.detail) || '—'} |`);
  }
  lines.push('', '## SQLite tables (post-run, node vs rust data dir)', '');
  lines.push('> Host-dependent: the Node daemon persists resolved adapter executable paths ' +
    '(`provider.<adapter>.executablePath`) as a side effect of adapter resolution, so the ' +
    '`settings` row count and any `provider.*.executablePath` rows vary with the toolchain ' +
    'installed on the machine that generated this report. Those rows are classified ' +
    'EXPECTED(phase4) (Rust adapter probing is Phase-4) and never counted as divergences; the ' +
    'row totals below are therefore not byte-reproducible across hosts.', '');
  lines.push('| Table | Rows (node/rust) | Verdict | First divergence |', '|---|---|---|---|');
  for (const r of dbRows) {
    lines.push(`| ${r.table} | ${r.rows} | ${r.verdict} | ${esc(r.detail) || '—'} |`);
  }
  if (skipped.length) {
    lines.push('', '## Skipped', '');
    for (const s of skipped) lines.push(`- ${s}`);
  }
  lines.push('');
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, lines.join('\n'));
}

function printTotals({ rows, dbRows }) {
  const identical = rows.filter((r) => r.verdict === 'IDENTICAL').length;
  const notIdentical = rows.filter((r) => r.verdict !== 'IDENTICAL');
  const real = rows.filter((r) => isReal(r.verdict));
  console.log(`\n=== diffd totals ===`);
  console.log(`routes compared: ${rows.length}  identical: ${identical}  ` +
    `expected/deviation: ${notIdentical.length - real.length}  unexplained-divergent: ${real.length}`);
  for (const r of notIdentical) console.log(`  ${r.verdict} ${r.id} [${r.status}] ${r.detail}`);
  const dbNot = dbRows.filter((r) => r.verdict !== 'IDENTICAL');
  const dbReal = dbRows.filter((r) => isReal(r.verdict));
  console.log(`sqlite tables: ${dbRows.length}  unexplained-divergent: ${dbReal.length}`);
  for (const r of dbNot) console.log(`  ${r.verdict} db:${r.table} ${r.detail}`);
  console.log(`report: ${REPORT}`);
  if (blockers.length) console.log(`blockers: ${blockers.length}`);
}

main().catch((e) => {
  console.error('diffd failed:', e.message);
  onExit();
  process.exit(1);
});
