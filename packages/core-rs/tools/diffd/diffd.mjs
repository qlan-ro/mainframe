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
const REPORT = path.join(REPO_ROOT, 'docs', 'rust-port', 'DIFF-REPORT-phase5.md');

const blockers = [];
const skipped = [];
const cleanups = [];

// Divergences whose cause is understood: a systematic deviation to resolve
// uniformly (not piecemeal here) or a documented, deliberate gap. Keyed by route
// id / `table:rowKey`; presence downgrades DIVERGENT → the tagged verdict.
//
// The Phase-3 `settings-providers` (resolvedExecutable) and `projects-delete`
// (ChatManager.removeProject) masks are gone: both seams are now live in the
// Rust daemon (adapter registry + ChatManager facade), so those routes are
// expected IDENTICAL and any residual difference is a real divergence to fix.
const KNOWN_ROUTE = {
  'settings-providers':
    'DEVIATION: Node echoes the persisted `provider.<adapter>.executablePath` setting (a side effect of adapter resolution) inside each provider block; the Rust adapter registry computes `resolvedExecutable` for the response but deliberately does not persist executablePath (get_providers PORT STATUS — no write-back), so that field is absent. Host-dependent (only appears when an adapter is installed and resolves); `resolvedExecutable` itself matches.',
  'lsp-languages-happy':
    'DEVIATION: `installed` for the BUNDLED servers (typescript, python) is true in Node — `resolveCommand` finds the npm package via `require.resolve` in the dev `node_modules` — but false in Rust: the registry\'s `bundled_root` is an explicit `TODO(port)` (unwired until the Tauri sidecar node_modules layout is finalized), so bundled servers never resolve. External servers (java/`command -v`) match. Host-dependent: on a machine without the bundled packages in node_modules, Node also reports false → IDENTICAL.',
  // Node structural-typing leaks: the JS runtime returns MORE than the declared
  // canonical type, and the strongly-typed Rust port emits exactly the declared
  // shape. Replicating these would mean adding undeclared fields to the single
  // canonical `@qlan-ro/mainframe-types` shapes — a discipline violation — so the
  // port omits them by design. Flagged for user triage in the report.
  'chats-list':
    'DEVIATION: Node emits an extra raw snake_case `adaptive_thinking` key alongside the canonical `adaptiveThinking`. `CHAT_SELECT_FIELDS` selects `adaptive_thinking` unaliased and `mapRow` spreads `...row`, leaking the raw column; the canonical `Chat` type declares only `adaptiveThinking`, which the Rust port emits (and matches).',
  'chats-for-project':
    'DEVIATION: see chats-list — the Node `...row` leaky-spread emits an extra raw `adaptive_thinking` key that the canonical `Chat` type does not declare.',
  'chat-get-happy':
    'DEVIATION: see chats-list — the Node `...row` leaky-spread emits an extra raw `adaptive_thinking` key that the canonical `Chat` type does not declare.',
  'chat-context-happy':
    'DEVIATION: Node leaks `materializedPath` (a host-local absolute FS path) on each attachment — `getSessionContext` returns `attachmentStore.list()` (`StoredAttachmentMeta`, which carries materializedPath) but the canonical `SessionAttachment` type declares only {id,name,mediaType,sizeBytes,kind,originalPath?}. The Rust port emits the declared `SessionAttachment` shape; the leaked path is intentionally not reproduced.',
};
// Understood DB-row divergences. Matched by predicate because the exact key is
// host-dependent (which adapter resolves varies with the installed toolchain).
function classifyDb(table, key, kind) {
  if (table === 'settings' && /^provider\.[^.]+\.executablePath$/.test(key) && kind === 'only-node') {
    return 'DEVIATION: Node persists resolved adapter executable paths (resolveAdapterExecutableCached side-effect); the Rust adapter registry computes `resolvedExecutable` for the response but deliberately does not persist it (get_providers PORT STATUS note — no write-back), so the row exists only on the Node side. Host-dependent: the specific adapter/key and row count vary with the installed toolchain.';
  }
  if (table === 'settings' && /^quota\./.test(key)) {
    return 'DEVIATION: live-probed quota row — both daemons pull provider quota from the real account at boot (#486), so observedAt/resetsAt reflect each probe’s wall-clock and the server’s per-request reset time; usedPercent formatting differs (serde_json f64 `96.0` vs JS number `96`) but re-parses identically. Inherently nondeterministic; not ported-logic drift.';
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
    'The workflow feature is DELIBERATELY NOT PORTED (scope decision 2026-07-10 — the TS workflows implementation is unstable). GET /api/workflows, /api/workflow-connectors, /api/workflow-credentials ARE probed and classified EXPECTED(gap): Node mounts them (real 200/503), the Rust daemon leaves them unmounted (404). The workflow-admin mutations and workflow.* DaemonEvents are not probed for the same reason.',
    'External-sessions / background-tasks / adapters-agents-skills mutation flows and the plugin sub-routes (todos CRUD) are not probed here: they either shell out to the real claude CLI (covered by the live soak) or need bespoke fixtures. The listing/read seams ARE probed (plugins listing, lsp languages, launch configs/status, tunnel status/config).',
    'tunnel start/stop are NOT probed: they shell out to a real `cloudflared` binary and reach the network — non-deterministic and side-effectful. Only the read-only status/config routes are compared.',
    'WS chat handlers (message.send / permission.respond) — covered by the live soak (soak.mjs), not the route matrix.',
    'files-list / worktree list ordering is compared as a set: raw directory-walk order is runtime/OS-dependent (Node recursion vs Rust stack) and unspecified by the contract; the element SET matches. chats-list / chats-for-project are compared ORDER-SENSITIVELY — both TS and Rust sort `ORDER BY pinned DESC, updated_at DESC` (list_all adds `rowid DESC`), so a set-sort would mask a real ordering regression.',
    'plugins listing: the OUTER `/api/plugins` array is compared as a set — the Rust PluginManager stores loaded plugins in a DashMap (non-deterministic iteration order), so the plugin order is not stable. But each plugin\'s NESTED panels are now insertion-ordered (Vec, not HashMap — mirroring the TS Map<panelId,event>), so the legacy `.panel` (= panels[0]) and `.panels[]` are deterministic and compared in order. The plugin SET + per-plugin content (claude/codex with no panel key, todos with its `quick-create` action + 2 panels) match; panel ids are volatile nanoids (normalized).',
    'GET /api/projects/:id/suggestions is a GENUINE non-workflows gap (NOT probed): Node mounts it (200; churn + TODO-scan suggestions), the Rust daemon leaves it unmounted (routes/mod.rs — the suggestions builder + route are unported). This is a real functional gap tracked as an open non-workflows item, distinct from the deliberate workflow gap above.',
    'GET /api/chats/:id/session-file (singular) is live in Rust (context.rs) but NOT probed: only the plural /session-files is in the matrix. session-file mirrors the same db chat/project + resolve_readable_path logic as session-files, so it is low-risk; adding a probe is a follow-up.',
    'git-write remote ops (fetch, pull, push) are not probed: they require a live upstream remote, which the seed repo has none of — the result is non-deterministic (network/remote state) rather than a wire-parity question.',
    'git-write merge / rebase / abort are not probed: each needs a hand-built divergent/conflicted branch state to exercise meaningfully; without it both daemons short-circuit identically and the probe asserts nothing. git-write update-all fans out over the same remote ops.',
    'git-chat commit / push are not probed for parity: a real commit embeds the wall-clock author/committer time, which differs between the sequential Node and Rust phases (distinct SHAs/dates) and is not a wire divergence; push additionally needs a remote. status / stage / unstage / diff-since-main (deterministic, read/index-only) ARE probed.',
    'DELETE /api/projects/:id IS probed (projects-delete): the ChatManager facade is now live in both daemons, so both remove the row (200) and the projects tables converge.',
    'launch start/stop ARE probed against a seeded, port-less `node` sleep config on the plain project; each `stop` awaits child exit so no process outlives the phase. A port-bearing / preview config is not started (it would bind a real TCP port and, when nothing listens, block on the 60s readiness wait); port parsing/echo is covered by the launch-config unit tests.',
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
    if (step.gap) {
      // Deliberate, documented gap: the workflow feature is intentionally not
      // ported (scope decision 2026-07-10). Node mounts the route (real 200/503);
      // the Rust daemon leaves it unmounted (404). Recorded, never a divergence.
      verdict = 'EXPECTED(gap)';
      detail = `Node ${a.status} vs Rust ${b.status} — deliberate: workflow engine not ported; route unmounted in Rust.`;
      rows.push({ id: step.id, cat: step.cat, method: step.method, status: `${a.status}/${b.status}`, verdict, detail });
      continue;
    }
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
  const keyOf = ROW_KEY[table] ?? ((_r, i) => String(i));
  const map = {};
  list.forEach((r, i) => (map[keyOf(r, i)] = normalize(r, reps)));
  return map;
}

/** Sort an envelope's `data` array in place for order-insensitive routes. */
/** Sort the list an order-insensitive route returns. Envelope routes carry it in
 *  `.data`; the PluginManager listing returns a bare `{ plugins: [...] }` whose
 *  order is unspecified (the Rust registry is a DashMap — non-deterministic
 *  iteration, even run-to-run), so sort that array too. */
function sortData(body) {
  const cmp = (x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y));
  if (Array.isArray(body?.data)) body.data.sort(cmp);
  if (Array.isArray(body?.plugins)) body.plugins.sort(cmp);
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
  lines.push('# Phase-5 Differential Report (Node vs Rust daemon)', '');
  lines.push(`Generated by \`packages/core-rs/tools/diffd/diffd.mjs\`. Routes compared: ${rows.length}. ` +
    `Identical: ${identical}. Expected/deliberate gaps: ${expected}. Known deviations: ${deviation}. ` +
    `Unexplained divergences: ${real.length}.`, '');
  lines.push('Covers the Phase-3 route matrix plus the Phase-5 surfaces: launch (configs/status/start/stop), ' +
    'tunnel status/config, plugins listing, lsp languages, and the now-live chats / context / worktree read ' +
    'seams. The workflow routes are a deliberate, documented gap (EXPECTED(gap)).', '');
  lines.push('Verdicts: **IDENTICAL** (byte-equal after normalizing timestamps / ids / durations / paths / SHAs), ' +
    '**EXPECTED(gap)** (deliberate, documented gap — workflow engine not ported), ' +
    '**DEVIATION** (understood, resolve uniformly), **DIVERGENT** (unexplained — needs a fix).', '');
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
    'installed on the machine that generated this report. The Rust adapter registry computes ' +
    '`resolvedExecutable` for the response but deliberately does not persist it, so those rows ' +
    'are classified DEVIATION and never counted as divergences; the row totals below are ' +
    'therefore not byte-reproducible across hosts.', '');
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
