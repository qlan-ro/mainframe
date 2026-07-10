#!/usr/bin/env node
// soak — the Phase-4 LIVE differential soak (daemon-rust-port Task 4.7).
//
// Boots the Node daemon and the Rust daemon side-by-side on cloned temp data
// dirs and, for each, drives the REAL claude CLI over WS + HTTP through three
// scripted scenarios: (1) a PARITY text reply, (2) a tool-permission allow, and
// (3) an interrupt. It records the ORDERED DaemonEvent-type sequence + key
// payload fields per daemon, normalizes volatile data (ids / timestamps / costs /
// durations / model versions / paths), then compares STRUCTURE (event types +
// fields present); the PARITY scenario also compares the assistant text.
//
// Env hygiene: temp dirs only (never ~/.mainframe), ephemeral ports, both daemons
// killed on exit. If the claude CLI / auth is unavailable, the live scenarios are
// skipped and the run degrades to a documented blocker (the recorded-fixture
// replay fallback is noted in the report).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Daemon } from './lib/daemon.mjs';
import { deepDiff } from './lib/normalize.mjs';
import { runAllScenarios } from './lib/soak-scenarios.mjs';
import { freePort } from './lib/util.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../../..');
const RUST_DIR = path.join(REPO_ROOT, 'packages', 'core-rs');
const NODE_DIST = path.join(REPO_ROOT, 'packages', 'core', 'dist', 'index.js');
const RUST_BIN = path.join(RUST_DIR, 'target', 'debug', 'mainframe-daemon');
const REPORT = path.join(REPO_ROOT, 'docs', 'rust-port', 'SOAK-REPORT-phase4.md');

const blockers = [];
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

function cliAvailable() {
  try {
    const r = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 15000 });
    return r.status === 0 ? (r.stdout || '').trim() : null;
  } catch {
    return null;
  }
}

function buildNodeDaemon() {
  try {
    execFileSync('pnpm', ['--filter', '@qlan-ro/mainframe-types', 'build'], { cwd: REPO_ROOT, stdio: 'pipe' });
    execFileSync('pnpm', ['--filter', '@qlan-ro/mainframe-core', 'build'], { cwd: REPO_ROOT, stdio: 'pipe' });
  } catch (e) {
    if (!fs.existsSync(NODE_DIST)) {
      const detail = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
      blockers.push(`Node build failed and no prebuilt dist exists: ${detail.trim().split('\n').slice(-3).join(' ')}`);
      throw new Error('cannot obtain a Node daemon build');
    }
    blockers.push('Node daemon build failed; fell back to the prebuilt packages/core/dist/index.js.');
  }
  return { cmd: process.execPath, args: [NODE_DIST], cwd: REPO_ROOT };
}

function buildRustDaemon() {
  execFileSync('cargo', ['build', '-p', 'mainframe-daemon'], { cwd: RUST_DIR, stdio: 'pipe' });
  return { cmd: RUST_BIN, args: [], cwd: RUST_DIR };
}

const GIT_ENV = ['-c', 'user.email=soak@example.com', '-c', 'user.name=soak'];
function buildRepo(dir) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# soak demo\n');
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'export const answer = 42;\n');
  const git = (args) => execFileSync('git', [...GIT_ENV, ...args], { cwd: dir, stdio: 'pipe' });
  git(['init', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-m', 'initial commit']);
}

async function runPhase(kind, cmd, dataDir, repo, logPath) {
  const port = await freePort();
  const daemon = new Daemon({ kind, cmd: cmd.cmd, args: cmd.args, dataDir, port, logPath, cwd: cmd.cwd });
  await daemon.start();
  let phase;
  try {
    phase = await runAllScenarios(kind, daemon.baseUrl, { dataDir, repo });
  } finally {
    await daemon.stop();
  }
  phase.logTail = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').split('\n').slice(-40) : [];
  return phase;
}

async function main() {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soak-'));
  cleanups.push(() => fs.rmSync(workRoot, { recursive: true, force: true }));

  const cliVersion = cliAvailable();
  if (!cliVersion) {
    blockers.push(
      'claude CLI / auth unavailable (`claude --version` failed): the live soak could not run. ' +
        'Fallback = the recorded-fixture replay (adapter tests’ recorded streams through a fake CLI) — ' +
        'not executed here; re-run on an authenticated machine.',
    );
  }

  const nodeCmd = buildNodeDaemon();
  const rustCmd = buildRustDaemon();

  const repo = path.join(workRoot, 'repo');
  buildRepo(repo);
  const repoBackup = path.join(workRoot, 'repo-backup');
  fs.cpSync(repo, repoBackup, { recursive: true });
  const restoreRepo = () => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.cpSync(repoBackup, repo, { recursive: true });
  };

  const nodeDir = path.join(workRoot, 'node-data');
  const rustDir = path.join(workRoot, 'rust-data');
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.mkdirSync(rustDir, { recursive: true });

  let nodePhase = { results: [], skipped: true };
  let rustPhase = { results: [], skipped: true };
  if (cliVersion) {
    nodePhase = await runPhase('node', nodeCmd, nodeDir, repo, path.join(workRoot, 'node-daemon.log'));
    restoreRepo();
    rustPhase = await runPhase('rust', rustCmd, rustDir, repo, path.join(workRoot, 'rust-daemon.log'));
  }

  const report = compare(nodePhase, rustPhase, cliVersion);
  writeReport(report, { nodePhase, rustPhase, cliVersion });
  onExit();
  printTotals(report);
}

function compare(nodePhase, rustPhase, cliVersion) {
  const names = [...new Set([...nodePhase.results, ...rustPhase.results].map((r) => r.name))];
  const rows = [];
  for (const name of names) {
    const n = nodePhase.results.find((r) => r.name === name);
    const r = rustPhase.results.find((x) => x.name === name);
    let verdict = 'UNKNOWN';
    let detail = '';
    if (!cliVersion) {
      verdict = 'SKIPPED';
      detail = 'claude CLI/auth unavailable';
    } else if (!r || !r.ok) {
      verdict = 'BLOCKED(rust)';
      detail = r?.error ?? 'no rust result';
    } else if (!n || !n.ok) {
      verdict = 'BLOCKED(node)';
      detail = n?.error ?? 'no node result';
    } else {
      const seqDiff = deepDiff(n.eventTypes, r.eventTypes);
      const traceDiff = deepDiff(n.trace, r.trace);
      if (!seqDiff && !traceDiff) {
        verdict = 'STRUCTURE-MATCH';
      } else {
        verdict = 'DIVERGENT';
        detail = seqDiff
          ? `event seq ${seqDiff.path}: ${JSON.stringify(seqDiff.a)} → ${JSON.stringify(seqDiff.b)}`
          : `trace ${traceDiff.path}: ${JSON.stringify(traceDiff.a)} → ${JSON.stringify(traceDiff.b)}`;
      }
      if (name === 'parity-text' && n.parityMatch !== r.parityMatch) {
        verdict = 'DIVERGENT';
        detail += ` | parity text node=${n.parityMatch} rust=${r.parityMatch}`;
      }
    }
    rows.push({ name, verdict, detail, node: n, rust: r });
  }
  return { rows };
}

function esc(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function fmtStream(result) {
  if (!result) return '_(none)_';
  if (!result.ok && result.createStatus) {
    return `create → HTTP ${result.createStatus} \`${esc(JSON.stringify(result.createBody))}\``;
  }
  if (!result.eventTypes?.length) return `_no events_ (${esc(result.error ?? 'unknown')})`;
  return '`' + result.eventTypes.join(' ') + '`';
}

function writeReport({ rows }, { nodePhase, rustPhase, cliVersion }) {
  const lines = [];
  lines.push('# Phase-4 LIVE Soak Report (Node vs Rust daemon, real claude CLI)', '');
  lines.push(
    'Generated by `packages/core-rs/tools/diffd/soak.mjs`. Each daemon booted on a ' +
      'private temp data dir; scenarios drove the **real** claude CLI over WS + HTTP. ' +
      'Structure (ordered event types + normalized payload fields) is compared; the ' +
      'parity scenario also compares assistant text.',
    '',
  );
  lines.push(
    `- claude CLI: ${cliVersion ? '`' + cliVersion + '`' : '**unavailable** (live soak skipped)'}`,
    `- Node model: ${nodePhase.model ? '`' + nodePhase.model + '`' : '—'} (cheapest advertised); adapter.installed probe: \`${nodePhase.adapterInstalled}\``,
    `- Rust model: ${rustPhase.model ? '`' + rustPhase.model + '`' : '—'}; adapter.installed probe: \`${rustPhase.adapterInstalled}\``,
    '',
  );
  if (blockers.length) {
    lines.push('## Blockers', '');
    for (const b of blockers) lines.push(`- ${b}`);
    lines.push('');
  }
  lines.push('## Verdicts', '');
  lines.push('| Scenario | Verdict | Detail |', '|---|---|---|');
  for (const r of rows) lines.push(`| ${r.name} | ${r.verdict} | ${esc(r.detail) || '—'} |`);
  lines.push('');
  lines.push(
    'Verdicts: **STRUCTURE-MATCH** (event-type sequence + normalized fields equal), ' +
      '**DIVERGENT** (a real structural/field difference — needs a fix), ' +
      '**BLOCKED(rust/node)** (that daemon could not run the scenario), ' +
      '**SKIPPED** (CLI/auth unavailable).',
    '',
  );
  for (const r of rows) {
    lines.push(`## Scenario: ${r.name}`, '');
    lines.push(`**Verdict:** ${r.verdict}. ${esc(r.detail)}`, '');
    lines.push(`**Node event stream:** ${fmtStream(r.node)}`, '');
    lines.push(`**Rust event stream:** ${fmtStream(r.rust)}`, '');
    if (r.name === 'parity-text' && r.node?.ok) {
      lines.push(`**Node assistant text:** \`${esc((r.node.assistantText || '').slice(0, 200))}\` (PARITY_OK: ${r.node.parityMatch})`, '');
    }
    if (r.name === 'tool-permission' && r.node?.ok) {
      lines.push(`**Node permission tool:** \`${esc(r.node.permissionToolName)}\`, permission.resolved seen: ${r.node.sawPermissionResolved}`, '');
    }
    if (r.name === 'interrupt' && r.node?.ok) {
      lines.push(`**Node interrupt:** POST /interrupt → HTTP ${r.node.interruptStatus}, process.stopped seen: ${r.node.sawProcessStopped}`, '');
    }
  }
  if (rustPhase.logTail?.length) {
    const seam = rustPhase.logTail.filter((l) => /Phase 4|seam|chat_manager|createChat/i.test(l));
    if (seam.length) {
      lines.push('## Rust daemon log (seam evidence)', '', '```', ...seam.slice(-12), '```', '');
    }
  }
  lines.push('');
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, lines.join('\n'));
}

function printTotals({ rows }) {
  console.log('\n=== soak totals ===');
  for (const r of rows) console.log(`  ${r.verdict.padEnd(16)} ${r.name}  ${r.detail}`);
  console.log(`report: ${REPORT}`);
  if (blockers.length) console.log(`blockers: ${blockers.length}`);
}

main().catch((e) => {
  console.error('soak failed:', e.stack || e.message);
  onExit();
  process.exit(1);
});
