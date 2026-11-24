// Every process here is one the test itself starts, on a port the system handed out as free.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { beginRun, ensurePortFree, isServing, recordStarted } from './port-guard.ts';
import { assertGone, assertSurvives, freePort, identityOf, until } from './port-guard.helpers.mjs';

const REMEDY = 'Use another port';
/** Children, whose handles cannot signal a reused pid. */
const started = new Set();
let dir;
let runs;
let script;

before(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'port-guard-')));
  script = path.join(dir, 'mainframe-daemon.mjs');
  writeFileSync(
    script,
    "import { createServer } from 'node:http';\n" +
      "const server = createServer((req, res) => res.end('{}'));\n" +
      "server.listen(Number(process.argv[2]), '127.0.0.1', () => console.log('up'));\n" +
      'setTimeout(() => process.exit(), 60_000);\n', // a failed test leaves nothing for long
  );
});
beforeEach(() => {
  runs = mkdtempSync(path.join(dir, 'runs-'));
});
afterEach(() => {
  for (const child of started) child.kill('SIGKILL');
  started.clear();
});
after(() => rmSync(dir, { recursive: true, force: true }));

const commandOn = (port) => [process.execPath, script, String(port)].join(' ');

async function startListener(port) {
  const child = spawn(process.execPath, [script, String(port)], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  started.add(child);
  await once(child.stdout, 'data');
  return child;
}

/** A listener whose parent has exited. */
async function startOrphan(port) {
  const code =
    `const c = require('child_process').spawn(process.execPath, [${JSON.stringify(script)}, '${port}'],` +
    ` { cwd: ${JSON.stringify(dir)}, stdio: 'ignore', detached: true }); console.log(c.pid); c.unref();`;
  const pid = Number(execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' }));
  await until(() => identityOf(pid)?.ppid === 1, 'the process was never orphaned');
  await until(() => fetch(`http://127.0.0.1:${port}`).then(Boolean, () => false), 'the orphan never listened');
  return pid;
}

async function assertRefused(port, pid, own) {
  await assert.rejects(ensurePortFree(port, own, REMEDY), (error) => {
    assert.match(error.message, new RegExp(`Port ${port} is taken`));
    assert.match(error.message, new RegExp(`pid ${pid}, `));
    assert.ok(error.message.includes(commandOn(port)), error.message);
    assert.ok(error.message.includes(dir), error.message);
    assert.ok(error.message.endsWith(REMEDY));
    return true;
  });
  await assertSurvives(pid);
}

const recordLine = (entry) => `${JSON.stringify(entry)}\n`;

test('a free port is free', async () => {
  await ensurePortFree(await freePort(), undefined, REMEDY);
});

test('a process this run did not start is named and left running, whatever it is called', async () => {
  const endRun = beginRun(runs);
  const port = await freePort();
  await assertRefused(port, (await startListener(port)).pid);
  endRun();
});

test('a process that only talks to the port is left running', async () => {
  const endRun = beginRun(runs);
  const port = await freePort();
  recordStarted(await startListener(port), port);
  const code = `require('net').connect(${port}, '127.0.0.1', () => console.log('up')).on('error', () => {}); setInterval(() => {}, 1000);`;
  const client = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'] });
  started.add(client);
  await once(client.stdout, 'data');
  await ensurePortFree(port, undefined, REMEDY);
  await assertSurvives(client.pid);
  endRun();
});

test('a process this run recorded on the port is stopped and the port is free', async () => {
  const endRun = beginRun(runs);
  const port = await freePort();
  const own = await startListener(port);
  recordStarted(own, port);
  await ensurePortFree(port, undefined, REMEDY);
  await assertGone(own.pid);
  endRun();
});

test('neither an earlier run’s record, nor one of another port, nor one of a reused pid counts', async () => {
  const endFirst = beginRun(runs);
  const port = await freePort();
  const { pid } = await startListener(port);
  const ledger = process.env.MF_E2E_RUN_LEDGER;
  const { started: since } = identityOf(pid);
  writeFileSync(ledger, recordLine({ pid, started: since, port }));

  const endSecond = beginRun(runs);
  await assertRefused(port, pid);
  endSecond();

  process.env.MF_E2E_RUN_LEDGER = ledger;
  writeFileSync(ledger, recordLine({ pid, started: since, port: port + 1 }));
  await assertRefused(port, pid);
  writeFileSync(ledger, recordLine({ pid, started: 'Mon Jan  1 00:00:00 2024', port }));
  await assertRefused(port, pid);
  // The end of the run, with that record, must not stop it either.
  endFirst();
  await assertSurvives(pid);
});

test('an orphan is stopped only when an earlier run of this worktree recorded it and nobody owns it', async () => {
  const port = await freePort();
  const own = { command: commandOn(port), cwd: dir };
  const endRun = beginRun(runs);
  const record = (pid, over = {}) =>
    writeFileSync(
      path.join(runs, 'earlier.jsonl'),
      recordLine({ pid, started: identityOf(pid).started, port, ...over }),
    );

  const parented = await startListener(port);
  record(parented.pid);
  await assertRefused(port, parented.pid, own);
  const exited = once(parented, 'exit');
  parented.kill('SIGKILL');
  await exited;

  // A detached daemon someone means to keep: same command, same directory, no parent, and no record.
  rmSync(path.join(runs, 'earlier.jsonl'));
  const orphan = await startOrphan(port);
  await assertRefused(port, orphan, own);
  record(orphan, { started: 'Mon Jan  1 00:00:00 2024' });
  await assertRefused(port, orphan, own);
  record(orphan, { port: port + 1 });
  await assertRefused(port, orphan, own);

  record(orphan);
  await assertRefused(port, orphan, undefined);
  await assertRefused(port, orphan, { ...own, cwd: tmpdir() });
  await assertRefused(port, orphan, { ...own, command: `${own.command} --other` });
  await ensurePortFree(port, own, REMEDY);
  await assertGone(orphan);
  endRun();
});

test('the end of a run stops what the run recorded and nothing else', async () => {
  const endRun = beginRun(runs);
  const [ownPort, otherPort] = [await freePort(), await freePort()];
  const own = await startListener(ownPort);
  const other = await startListener(otherPort);
  recordStarted(own, ownPort);
  const ownExit = once(own, 'exit');
  endRun();
  assert.deepEqual(await ownExit, [null, 'SIGKILL']);
  await assertSurvives(other.pid);
  assert.deepEqual(readdirSync(runs), []);
});

test('a crashed run’s record is kept while its process lives', async () => {
  beginRun(runs);
  const port = await freePort();
  const child = await startListener(port);
  recordStarted(child, port);
  const ledger = process.env.MF_E2E_RUN_LEDGER;
  beginRun(runs);
  assert.equal(JSON.parse(readFileSync(ledger, 'utf8')).pid, child.pid);
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  beginRun(runs);
  assert.deepEqual(readdirSync(runs), []);
});

test('a server is ours only while the child we started is the one listening', async () => {
  const port = await freePort();
  const silent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' });
  started.add(silent);
  assert.equal(isServing(silent, port, REMEDY), false);
  const child = await startListener(port);
  assert.equal(isServing(child, port, REMEDY), true);
  assert.throws(() => isServing(silent, port, REMEDY), new RegExp(`Port ${port} is taken[^]*pid ${child.pid}, `));
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  assert.throws(() => isServing(child, port, REMEDY), /exited \(SIGKILL\)/);
});
