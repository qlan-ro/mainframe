/**
 * The consumed-surface checklists are only trustworthy while every row still
 * points at code that exists. These cases pin the failure modes that rot a
 * checklist silently: a moved file, a renamed symbol, a row with no citation
 * at all, and a table that stopped matching the schema.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(scriptsDir, 'check-surface.mjs');

const HEADER = ['| ID | Surface | Upstream artifact | Mainframe consumer | Coverage | Verified | Symptom |', '|---|---|---|---|---|---|---|'].join('\n');

async function runCli(args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cli, ...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

async function fixture(rows) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'check-surface-'));
  const crate = path.join(dir, 'crate');
  await mkdir(path.join(crate, 'src'), { recursive: true });
  await writeFile(path.join(crate, 'src', 'events.rs'), 'fn handle_system_event() {}\n', 'utf8');
  const doc = path.join(dir, 'CONSUMED-SURFACE.md');
  await writeFile(doc, `${HEADER}\n${rows.join('\n')}\n`, 'utf8');
  return { doc, crate };
}

test('passes over the checklists committed in this repo', async () => {
  const run = await runCli([]);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /docs\/research\/adapters\/claude\/CONSUMED-SURFACE\.md: OK \(\d+ rows\)/);
  assert.match(run.stdout, /docs\/research\/adapters\/codex\/CONSUMED-SURFACE\.md: OK \(\d+ rows\)/);
});

test('flags a row citing a symbol its file does not define', async () => {
  const { doc, crate } = await fixture(['| CLAUDE-EVT-01 | x | y | `src/events.rs::handle_renamed_event` | none | — | z |']);
  const run = await runCli(['--doc', doc, '--crate', crate]);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /MISSING SYMBOL .*src\/events\.rs::handle_renamed_event/);
});

test('flags a row citing a file that has moved', async () => {
  const { doc, crate } = await fixture(['| CLAUDE-EVT-01 | x | y | `src/moved.rs::handle_system_event` | none | — | z |']);
  const run = await runCli(['--doc', doc, '--crate', crate]);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /MISSING FILE .*src\/moved\.rs/);
});

test('flags a row that cites no consumer at all', async () => {
  const { doc, crate } = await fixture(['| CLAUDE-EVT-01 | x | y | the events dispatcher | none | — | z |']);
  const run = await runCli(['--doc', doc, '--crate', crate]);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /NO CITATION.*CLAUDE-EVT-01/);
});

test('fails when the table stops matching the row schema, rather than passing on zero rows', async () => {
  const { doc, crate } = await fixture(['| EVT-01 | x | y | `src/events.rs::handle_system_event` | none | — | z |']);
  const run = await runCli(['--doc', doc, '--crate', crate]);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /NO ROWS/);
});

test('resolves a .tsx citation instead of truncating the extension', async () => {
  const { doc, crate } = await fixture([
    '| CODEX-FLAG-03 | x | y | `packages/ui/src/features/settings/panes/providers/CodexTuningDefaults.tsx` | none | — | z |',
  ]);
  const run = await runCli(['--doc', doc, '--crate', crate]);
  assert.equal(run.code, 0, run.stderr);
});
