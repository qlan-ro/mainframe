/**
 * Argument-validation gate for the fetcher. Every case here must fail before
 * the first network call and before `state.json` is touched: a malformed flag
 * that reached the write path once committed `"lastReviewedRef": "--json"`,
 * which then broke the anchor for every later run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(scriptsDir, 'fetch-delta.mjs');
const statePath = path.join(path.dirname(scriptsDir), 'state.json');

async function runCli(args) {
  const stateBefore = readFileSync(statePath, 'utf8');
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cli, ...args]);
    return { code: 0, stdout, stderr, stateChanged: readFileSync(statePath, 'utf8') !== stateBefore };
  } catch (err) {
    return {
      code: err.code,
      stdout: err.stdout,
      stderr: err.stderr,
      stateChanged: readFileSync(statePath, 'utf8') !== stateBefore,
    };
  }
}

test('--max rejects a non-numeric value instead of slicing with NaN', async () => {
  const run = await runCli(['--tool', 'claude', '--max', 'abc']);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /--max/);
  assert.equal(run.stateChanged, false);
});

test('--max rejects 0 instead of crashing on an empty batch', async () => {
  const run = await runCli(['--tool', 'claude', '--max', '0']);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /--max/);
  assert.equal(run.stateChanged, false);
});

test('--commit-state refuses to swallow the next flag as its value', async () => {
  const run = await runCli(['--tool', 'claude', '--commit-state', '--json']);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /--commit-state/);
  assert.equal(run.stateChanged, false);
});

test('a value-taking flag at the end of argv fails instead of reading undefined', async () => {
  const run = await runCli(['--tool']);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /--tool/);
  assert.equal(run.stateChanged, false);
});
