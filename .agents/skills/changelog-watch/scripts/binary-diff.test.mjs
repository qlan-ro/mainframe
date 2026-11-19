/**
 * CLI gate for the binary diff. Runs offline: every case either fails during
 * argument validation or reads local files through --from-file/--to-file,
 * so no test downloads a 300MB binary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(scriptsDir, 'binary-diff.mjs');

async function runCli(args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cli, ...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'binary-diff-test-'));
}

test('--tool is required', async () => {
  const run = await runCli([]);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /--tool/);
});

test('a value flag refuses to swallow the next flag', async () => {
  const run = await runCli(['--tool', 'claude', '--from', '--json']);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /--from expects a value/);
});

test('a version with path characters is refused before any download', async () => {
  const run = await runCli(['--tool', 'claude', '--from', '../../etc', '--to', '2.1.326']);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /--from must be a version/);
});

test('a tool without a binary config is refused', async () => {
  const run = await runCli(['--tool', 'codex', '--from', '0.1.0', '--to', '0.2.0']);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /no binary\.npmPackage/);
});

test('diffs two local files into the report and refuses to overwrite it', async () => {
  const dir = tempDir();
  const before = path.join(dir, 'before.bin');
  const after = path.join(dir, 'after.bin');
  const out = path.join(dir, 'report.md');
  const pad = '\u0000'.repeat(64);
  writeFileSync(before, `${pad}{type:"local",name:"usage",x}${pad}`);
  writeFileSync(after, `${pad}{type:"local",name:"usage",x}{type:"local",name:"project",x}${pad}`);

  const run = await runCli([
    '--tool',
    'claude',
    '--from',
    '2.1.1',
    '--to',
    '2.1.2',
    '--from-file',
    before,
    '--to-file',
    after,
    '--out',
    out,
    '--json',
  ]);
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { tool: 'claude', from: '2.1.1', to: '2.1.2', changes: 1, out });
  assert.match(readFileSync(out, 'utf8'), /## Slash commands\n\nAdded \(1\):\n\n- `project`/);

  const again = await runCli([
    '--tool',
    'claude',
    '--from',
    '2.1.1',
    '--to',
    '2.1.2',
    '--from-file',
    before,
    '--to-file',
    after,
    '--out',
    out,
  ]);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /refusing to overwrite/);
});
