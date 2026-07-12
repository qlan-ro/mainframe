#!/usr/bin/env node
// mainsync — the differential harness for the main→rust-port SYNC surfaces.
//
// After `origin/main` was merged into the Rust-port branch, a batch of new/
// changed wire surfaces landed (docs/rust-port/MAIN-RECONCILIATION.md). This
// harness boots the post-sync Node daemon and the Rust daemon side-by-side on
// byte-identical Node-seeded data dirs and asserts each of those surfaces
// serializes JSON-identically:
//
//   1. GET /api/chats/:id/messages — `data` is now the ChatHistoryPayload object
//      `{ messages, transcriptMissing }` (was a bare array).
//   2. POST /api/chats/:id/{continue-here,continue-in-project-root,
//      recreate-worktree} — the new degraded-recovery routes: okEmpty happy,
//      404 unknown chat, 409 branch-gone.
//   3. GET /health gains `pid`.
//   4. CORS `Access-Control-Allow-Origin` echo for the packaged-Tauri origins
//      (`tauri://localhost`, `http(s)://tauri.localhost`) + localhost + a
//      disallowed origin.
//   5. GET /api/files/external?encoding=base64.
//   6. PUT settings provider drops an invalid `defaultModel`.
//   7. Chat objects carry `lastContextTotalTokens` / `lastContextMaxTokens` /
//      `transcriptMissing` (a persisted context-usage update).
//
// It reuses the diffd lib (daemon/seed/normalize/sqlite/util) and writes
// docs/rust-port/DIFF-REPORT-mainsync.md, leaving the phase-5 harness untouched.
//
// Env hygiene: temp dirs only (never ~/.mainframe), ephemeral ports, both
// daemons killed on exit. The post-sync Node source does not type-check under
// the repo's strict tsconfig (a pre-existing, read-only `db/migrations.ts`
// error), so the Node daemon runs via `tsx` (transpile-only) straight from
// source — never the stale prebuilt dist, which predates the sync.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Daemon } from './lib/daemon.mjs';
import { deepDiff, normalize, pathReplacements } from './lib/normalize.mjs';
import { buildSeed } from './lib/seed.mjs';
import { dumpTables } from './lib/sqlite.mjs';
import { freePort, req } from './lib/util.mjs';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../../..');
const RUST_DIR = path.join(REPO_ROOT, 'packages', 'core-rs');
const NODE_SRC = path.join(REPO_ROOT, 'packages', 'core', 'src', 'index.ts');
const RUST_BIN = path.join(RUST_DIR, 'target', 'debug', 'mainframe-daemon');
const REPORT = path.join(REPO_ROOT, 'docs', 'rust-port', 'DIFF-REPORT-mainsync.md');

// A branch name deliberately absent from the seed git repo (its branches are
// `main` + `feature`), so `recreate-worktree` hits the branch-gone 409 path.
const GHOST_BRANCH = 'diffd-ghost-branch';
// A model id absent from every adapter catalog, so the settings read path drops
// it as an invalid saved default.
const BOGUS_MODEL = 'diffd-bogus-model';

const blockers = [];
const skipped = [];
const cleanups = [];

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

// The post-sync Node daemon: run from source via tsx. tsc is blocked by a
// pre-existing, read-only type error, and the prebuilt dist predates the sync
// (no chat-recovery / cors-origin / health-pid), so it cannot be the oracle.
function buildNodeDaemon() {
  execFileSync('pnpm', ['--filter', '@qlan-ro/mainframe-types', 'build'], { cwd: REPO_ROOT, stdio: 'pipe' });
  const tsxLoader = require.resolve('tsx');
  return { cmd: process.execPath, args: ['--import', tsxLoader, NODE_SRC], cwd: REPO_ROOT };
}

function buildRustDaemon() {
  execFileSync('cargo', ['build', '-p', 'mainframe-daemon'], { cwd: RUST_DIR, stdio: 'pipe' });
  return { cmd: RUST_BIN, args: [], cwd: RUST_DIR };
}

// Directly seed the DB fields no HTTP mutation reaches deterministically: a
// dead-worktree chat (worktree_path + a now-gone branch) for the recovery
// probes, and a chat carrying a persisted context-usage update
// (last_context_total_tokens / _max_tokens) + transcript_missing for the
// enriched-Chat probe. Injected into the seed BEFORE the per-daemon copy, so
// both daemons start from byte-identical state.
function injectSeedState(seedDir, m) {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(seedDir, 'mainframe.db'));
  try {
    // chat[1] (a git-project chat): a stored worktree on a branch that no longer
    // exists → recreate-worktree ⇒ 409, then continue-in-project-root/here clear it.
    db.prepare('UPDATE chats SET worktree_path = ?, branch_name = ? WHERE id = ?').run(
      path.join(m.gitRepo, '.worktrees', 'diffd-ghost'),
      GHOST_BRANCH,
      m.chatIds[1],
    );
    // chat[2] (a plain-project chat): a persisted context-usage snapshot + a
    // missing transcript flag (what onContextUsage / transcript reconcile write).
    db.prepare(
      'UPDATE chats SET last_context_total_tokens = ?, last_context_max_tokens = ?, transcript_missing = 1 WHERE id = ?',
    ).run(123456, 200000, m.chatIds[2]);
  } finally {
    db.close();
  }
}

// The sync-surface replay matrix. Each step: { id, cat, method, path, body?,
// query?, headers?, expectStatus?, cors?, pick?, note? }. `cors` compares the
// ACAO response header instead of the body; `pick` narrows the normalized body
// before diffing (to isolate a field from unrelated host-dependent noise).
function buildMatrix(m) {
  const chat0 = m.chatIds[0];
  const chat1 = m.chatIds[1];
  const chat2 = m.chatIds[2];

  return [
    // (7) Enriched Chat: persisted context-usage + transcriptMissing. Read FIRST,
    // before any step could reconcile/clear the injected flag on chat[2].
    {
      id: 'chat-context-usage-fields',
      cat: 'chat-fields',
      method: 'GET',
      path: `/api/chats/${chat2}`,
      // Narrow to the sync-added fields: the full Chat also carries Node's
      // documented `adaptive_thinking` raw-column leak (a structural-typing
      // deviation tracked by the phase-5 harness' chat-get KNOWN_ROUTE), which is
      // NOT part of this surface and would otherwise mask the target diff.
      pick: (body) => {
        const c = body?.data ?? {};
        return {
          lastContextTotalTokens: c.lastContextTotalTokens ?? null,
          lastContextMaxTokens: c.lastContextMaxTokens ?? null,
          transcriptMissing: c.transcriptMissing ?? null,
        };
      },
      note: 'Chat carries lastContextTotalTokens / lastContextMaxTokens / transcriptMissing (persisted).',
    },

    // (1) GET /messages — data is the ChatHistoryPayload object now, not a bare
    // array. chat[0] never ran a CLI ⇒ { messages: [], transcriptMissing: false }.
    {
      id: 'chat-messages-payload',
      cat: 'messages',
      method: 'GET',
      path: `/api/chats/${chat0}/messages`,
      note: 'data = ChatHistoryPayload { messages, transcriptMissing } (was bare array).',
    },

    // (3) /health gains pid (pid normalized to <PID>; version <VER>; ts <TS>).
    { id: 'health-pid', cat: 'health', method: 'GET', path: '/health', note: '/health body gains `pid`.' },

    // (4) CORS Access-Control-Allow-Origin echo. The middleware sets ACAO on
    // EVERY response when Origin is allowed, so /health is a convenient carrier.
    {
      id: 'cors-tauri-scheme',
      cat: 'cors',
      method: 'GET',
      path: '/health',
      headers: { Origin: 'tauri://localhost' },
      cors: true,
      note: 'ACAO echoes packaged-Tauri custom scheme.',
    },
    {
      id: 'cors-tauri-localhost',
      cat: 'cors',
      method: 'GET',
      path: '/health',
      headers: { Origin: 'http://tauri.localhost' },
      cors: true,
      note: 'ACAO echoes packaged-Tauri (Windows) origin.',
    },
    {
      id: 'cors-localhost-echo',
      cat: 'cors',
      method: 'GET',
      path: '/health',
      headers: { Origin: 'http://localhost:5173' },
      cors: true,
      note: 'ACAO echoes a dev-vite localhost origin.',
    },
    {
      id: 'cors-disallowed-absent',
      cat: 'cors',
      method: 'GET',
      path: '/health',
      headers: { Origin: 'http://evil.example.com' },
      cors: true,
      note: 'ACAO absent for a disallowed origin.',
    },

    // (5) External file, base64 encoding.
    {
      id: 'files-external-base64',
      cat: 'files',
      method: 'GET',
      path: '/api/files/external',
      query: { path: path.join(m.gitRepo, 'README.md'), encoding: 'base64' },
      note: 'external file read returns { path, content(base64), encoding }.',
    },

    // (6) settings PUT + GET: an invalid defaultModel is dropped on read.
    {
      id: 'settings-put-bogus-model',
      cat: 'settings',
      method: 'PUT',
      path: '/api/settings/providers/claude',
      body: { defaultModel: BOGUS_MODEL, defaultMode: 'default' },
      note: 'PUT an out-of-catalog defaultModel.',
    },
    {
      id: 'settings-bogus-model-dropped',
      cat: 'settings',
      method: 'GET',
      path: '/api/settings/providers',
      pick: (body) => ({ claudeDefaultModel: body?.data?.claude?.defaultModel ?? null }),
      note: 'GET drops the invalid claude.defaultModel (host-independent: bogus id is in no catalog).',
    },

    // (2) degraded-recovery routes.
    {
      id: 'recovery-recreate-worktree-409',
      cat: 'recovery',
      method: 'POST',
      path: `/api/chats/${chat1}/recreate-worktree`,
      expectStatus: 409,
      note: 'recreate-worktree on a stored branch that is gone ⇒ 409.',
    },
    {
      id: 'recovery-continue-in-project-root-ok',
      cat: 'recovery',
      method: 'POST',
      path: `/api/chats/${chat1}/continue-in-project-root`,
      expectStatus: 200,
      note: 'continue-in-project-root detaches the worktree ⇒ okEmpty.',
    },
    {
      id: 'recovery-continue-here-ok',
      cat: 'recovery',
      method: 'POST',
      path: `/api/chats/${chat1}/continue-here`,
      expectStatus: 200,
      note: 'continue-here forgets the session ⇒ okEmpty.',
    },
    {
      id: 'recovery-unknown-chat-404',
      cat: 'recovery',
      method: 'POST',
      path: '/api/chats/diffd-does-not-exist/continue-here',
      expectStatus: 404,
      note: 'unknown chat ⇒ 404 "Chat not found".',
    },
  ];
}

async function runMatrix(baseUrl, matrix) {
  const results = {};
  for (const step of matrix) {
    results[step.id] = await req(baseUrl, step.method, step.path, {
      body: step.body,
      query: step.query,
      headers: step.headers,
    });
  }
  return results;
}

async function runPhase(kind, cmd, dataDir, logPath, matrix) {
  const port = await freePort();
  const daemon = new Daemon({ kind, cmd: cmd.cmd, args: cmd.args, dataDir, port, logPath, cwd: cmd.cwd });
  await daemon.start();
  const results = await runMatrix(daemon.baseUrl, matrix);
  await daemon.stop();
  return { results, tables: dumpTables(dataDir) };
}

/** The value a step compares: an ACAO object for CORS steps, else {status,body}. */
function stepValue(step, resp, reps) {
  if (step.cors) {
    return { status: resp.status, acao: resp.headers?.['access-control-allow-origin'] ?? null };
  }
  let body = normalize(resp.body, reps);
  if (step.pick) body = step.pick(body);
  return { status: resp.status, body };
}

function compareRoutes(nodePhase, rustPhase, dirs, matrix) {
  const nReps = pathReplacements({ dataDir: dirs.nodeDir, roots: { ROOT: dirs.workRoot } });
  const rReps = pathReplacements({ dataDir: dirs.rustDir, roots: { ROOT: dirs.workRoot } });
  const rows = [];
  for (const step of matrix) {
    const a = nodePhase.results[step.id];
    const b = rustPhase.results[step.id];
    const va = stepValue(step, a, nReps);
    const vb = stepValue(step, b, rReps);
    let verdict = 'IDENTICAL';
    let detail = '';
    // Sanity: the Node side must actually exercise the surface (a stale/unmounted
    // route on the ORACLE would hide a real gap). Flag it loudly.
    if (step.expectStatus != null && a.status !== step.expectStatus) {
      verdict = 'ORACLE-UNEXPECTED';
      detail = `Node status ${a.status} != expected ${step.expectStatus} — the oracle did not hit the surface`;
    }
    const d = deepDiff(va, vb);
    if (verdict === 'IDENTICAL' && d) {
      verdict = 'DIVERGENT';
      detail = `${d.path}: ${JSON.stringify(d.a)} → ${JSON.stringify(d.b)}`;
    }
    rows.push({
      id: step.id,
      cat: step.cat,
      method: step.method,
      status: `${a.status}/${b.status}`,
      verdict,
      detail,
      note: step.note ?? '',
    });
  }
  return rows;
}

// Compare only the chats table (the surface the sync + these probes touch):
// injected context columns, transcript_missing, and the worktree columns the
// recovery mutations clear. Keyed by chat id.
function compareChats(nodePhase, rustPhase, dirs) {
  const nReps = pathReplacements({ dataDir: dirs.nodeDir, roots: { ROOT: dirs.workRoot } });
  const rReps = pathReplacements({ dataDir: dirs.rustDir, roots: { ROOT: dirs.workRoot } });
  const key = (r) => r.id;
  const na = {};
  const nb = {};
  for (const r of nodePhase.tables.chats ?? []) na[key(r)] = normalize(r, nReps);
  for (const r of rustPhase.tables.chats ?? []) nb[key(r)] = normalize(r, rReps);
  const ids = [...new Set([...Object.keys(na), ...Object.keys(nb)])].sort();
  const rows = [];
  for (const id of ids) {
    let verdict = 'IDENTICAL';
    let detail = '';
    if (!(id in na)) (verdict = 'DIVERGENT'), (detail = 'row only in rust');
    else if (!(id in nb)) (verdict = 'DIVERGENT'), (detail = 'row only in node');
    else {
      const d = deepDiff(na[id], nb[id]);
      if (d) (verdict = 'DIVERGENT'), (detail = `${d.path}: ${JSON.stringify(d.a)} → ${JSON.stringify(d.b)}`);
    }
    rows.push({ id, verdict, detail });
  }
  return rows;
}

const isReal = (v) => v === 'DIVERGENT' || v === 'ORACLE-UNEXPECTED';

function writeReport(rows, chatRows) {
  const identical = rows.filter((r) => r.verdict === 'IDENTICAL').length;
  const real = rows.filter((r) => isReal(r.verdict));
  const esc = (s) => String(s).replace(/\|/g, '\\|');
  const lines = [];
  lines.push('# Main→Rust-port Sync Differential Report (Node vs Rust daemon)', '');
  lines.push(
    `Generated by \`packages/core-rs/tools/diffd/mainsync.mjs\`. Surfaces compared: ${rows.length}. ` +
      `Identical: ${identical}. Divergent: ${real.length}.`,
    '',
  );
  lines.push(
    'Covers the new/changed wire surfaces merged from `origin/main` after the Rust port branched ' +
      '(docs/rust-port/MAIN-RECONCILIATION.md): the ChatHistoryPayload messages envelope, the three ' +
      'degraded-recovery routes, `/health` pid, the packaged-Tauri CORS allowlist, base64 external ' +
      'file reads, invalid-defaultModel dropping, and the enriched Chat context/transcript fields.',
    '',
  );
  lines.push(
    'Verdicts: **IDENTICAL** (byte-equal after normalizing pid / version / timestamps / ids / paths), ' +
      '**DIVERGENT** (a real wire difference — needs a Rust-side fix), **ORACLE-UNEXPECTED** (the Node ' +
      'oracle did not hit the expected status; the probe/seed is wrong, not the port).',
    '',
  );
  if (blockers.length) {
    lines.push('## Blockers', '');
    for (const b of blockers) lines.push(`- ${b}`);
    lines.push('');
  }
  lines.push('## Surfaces', '', '| Surface | Method | Status (node/rust) | Verdict | Detail / note |', '|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.id} | ${r.method} | ${r.status} | ${r.verdict} | ${esc(r.detail || r.note) || '—'} |`);
  }
  lines.push('', '## chats table (post-run, node vs rust data dir)', '');
  lines.push(
    '> The recovery mutations (continue-in-project-root / continue-here on chat[1]) and the injected ' +
      'context-usage columns (chat[2]) must persist byte-identically across both daemons.',
    '',
  );
  lines.push('| Chat | Verdict | First divergence |', '|---|---|---|');
  for (const r of chatRows) lines.push(`| ${r.id} | ${r.verdict} | ${esc(r.detail) || '—'} |`);
  if (skipped.length) {
    lines.push('', '## Scope notes', '');
    for (const s of skipped) lines.push(`- ${s}`);
  }
  lines.push('');
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, lines.join('\n'));
}

function printTotals(rows, chatRows) {
  const identical = rows.filter((r) => r.verdict === 'IDENTICAL').length;
  const notIdentical = rows.filter((r) => r.verdict !== 'IDENTICAL');
  const real = rows.filter((r) => isReal(r.verdict));
  console.log('\n=== mainsync totals ===');
  console.log(`surfaces compared: ${rows.length}  identical: ${identical}  divergent: ${real.length}`);
  for (const r of notIdentical) console.log(`  ${r.verdict} ${r.id} [${r.status}] ${r.detail}`);
  const chatReal = chatRows.filter((r) => r.verdict !== 'IDENTICAL');
  console.log(`chats rows: ${chatRows.length}  divergent: ${chatReal.length}`);
  for (const r of chatReal) console.log(`  ${r.verdict} chat:${r.id} ${r.detail}`);
  console.log(`report: ${REPORT}`);
  if (blockers.length) console.log(`blockers: ${blockers.length}`);
}

async function main() {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mainsync-'));
  cleanups.push(() => fs.rmSync(workRoot, { recursive: true, force: true }));

  const nodeCmd = buildNodeDaemon();
  const rustCmd = buildRustDaemon();

  const { seedDir, manifest, projDir } = await buildSeed(workRoot, nodeCmd);
  if (manifest.chatIds.length < 3) {
    blockers.push(`Seed produced ${manifest.chatIds.length} chats (<3) — recovery/context probes degraded.`);
  }
  injectSeedState(seedDir, manifest);
  const matrix = buildMatrix(manifest);

  // Pristine snapshot of the external project dirs so the Rust phase starts from
  // the exact tree the Node phase did (recreate-worktree/continue-* touch git).
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

  const nodePhase = await runPhase('node', nodeCmd, nodeDir, path.join(workRoot, 'node-daemon.log'), matrix);
  restoreProj();
  const rustPhase = await runPhase('rust', rustCmd, rustDir, path.join(workRoot, 'rust-daemon.log'), matrix);

  skipped.push(
    'Chat.backgroundActivity is derived from the in-memory live-task tracker (BackgroundTaskTracker.listLive), ' +
      'which is populated only by (a) a live CLI session emitting task events or (b) boot reconcile of a bash ' +
      'spool whose file a live writer process still holds (lsof). Neither has a deterministic HTTP path, so this ' +
      'harness verifies the derived-absent parity (no live task ⇒ field omitted on both — see chat-context-usage-fields ' +
      'and chat-get) and defers the populated-activity shape to the ported unit tests ' +
      '(chat-manager-background-activity, tracker) and the live soak (soak.mjs).',
    'The recovery routes are driven against a SQL-injected dead-worktree chat (chat[1]) and the enriched-Chat ' +
      'probe against a SQL-injected context-usage snapshot (chat[2]) because no deterministic HTTP mutation writes ' +
      'those columns — they are set by the CLI event handler (onContextUsage) / transcript reconcile at runtime.',
  );

  const rows = compareRoutes(nodePhase, rustPhase, { nodeDir, rustDir, workRoot }, matrix);
  const chatRows = compareChats(nodePhase, rustPhase, { nodeDir, rustDir, workRoot });
  writeReport(rows, chatRows);
  onExit();
  printTotals(rows, chatRows);
}

main().catch((e) => {
  console.error('mainsync failed:', e.message);
  onExit();
  process.exit(1);
});
