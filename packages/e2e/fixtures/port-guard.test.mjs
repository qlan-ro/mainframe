// Every process here is one the test itself starts, on a port the system handed out as free.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { assertRunServes, beginRun, ensurePortFree, isServing, recordStarted } from './port-guard.ts';
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

/** The first line of a run's ledger: the run. By default one that is over. */
const runLine = (over = {}) =>
  recordLine({ run: true, pid: process.pid, started: 'Mon Jan  1 00:00:00 2024', ...over });
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
  const record = (pid, over = {}, run = runLine()) =>
    writeFileSync(
      path.join(runs, 'earlier.jsonl'),
      run + recordLine({ pid, started: identityOf(pid).started, port, ...over }),
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
  // A run that goes on, whose worker died: its retry stops the daemon. And a record that does not say whose it is.
  record(orphan, {}, runLine({ started: identityOf(process.pid).started }));
  await assertRefused(port, orphan, own);
  record(orphan, {}, '');
  await assertRefused(port, orphan, own);
  record(orphan);
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
  // That run is over.
  writeFileSync(process.env.MF_E2E_RUN_LEDGER, runLine());
  const port = await freePort();
  const child = await startListener(port);
  recordStarted(child, port);
  const ledger = process.env.MF_E2E_RUN_LEDGER;
  beginRun(runs);
  assert.match(readFileSync(ledger, 'utf8'), new RegExp(`^\\{"pid":${child.pid},`, 'm'));
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  beginRun(runs);
  assert.ok(!existsSync(ledger));
});

test('a run that has not started anything yet keeps its record when another begins', async () => {
  const endFirst = beginRun(runs);
  const ledger = process.env.MF_E2E_RUN_LEDGER;
  const endSecond = beginRun(runs);
  assert.ok(existsSync(ledger));
  endSecond();
  endFirst();
  assert.deepEqual(readdirSync(runs), []);
});

test('a torn line in a record hides neither the lines after it nor the record of another run', async () => {
  const torn = path.join(runs, 'torn.jsonl');
  writeFileSync(torn, '{"pid":12');
  const endRun = beginRun(runs);
  assert.ok(!existsSync(torn));
  const ledger = process.env.MF_E2E_RUN_LEDGER;
  appendFileSync(ledger, '{"pid":12,"star');
  writeFileSync(torn, 'null\n7\n"x"\n{"pid":"1","started":1,"port":2}\n');
  const port = await freePort();
  const own = await startListener(port);
  recordStarted(own, port);
  await ensurePortFree(port, undefined, REMEDY);
  await assertGone(own.pid);
  endRun();
});

test('what the run serves is told from what it does not, and from nothing', async () => {
  const endRun = beginRun(runs);
  const port = await freePort();
  assert.throws(() => assertRunServes(port, REMEDY), /Nothing listens/);
  const child = await startListener(port);
  assert.throws(() => assertRunServes(port, REMEDY), new RegExp(`Port ${port} is taken[^]*pid ${child.pid}, `));
  recordStarted(child, port);
  assertRunServes(port, REMEDY);
  endRun();
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

/** A server, and a child of it that holds its listener too, as a fork does until it execs. */
async function startForking(port) {
  const held =
    "const { spawn } = require('node:child_process');" +
    `const server = require('node:net').createServer().listen(${port}, '127.0.0.1', () => {` +
    // The child inherits the socket as its fd 3 and does nothing with it.
    "const kid = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: ['ignore', 'ignore', 'ignore', server._handle.fd] });" +
    `kid.on('spawn', () => { console.log(kid.pid); });` +
    '}); setTimeout(() => process.exit(), 60000);';
  const child = spawn(process.execPath, ['-e', held], { stdio: ['ignore', 'pipe', 'ignore'] });
  started.add(child);
  const [line] = await once(child.stdout, 'data');
  return { child, kid: Number(String(line).trim()) };
}

const listeners = (port) =>
  execFileSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map(Number);

test('a process our server started, which holds its listener, is not somebody else', async () => {
  const endRun = beginRun(runs);
  const port = await freePort();
  const { child, kid } = await startForking(port);
  assert.deepEqual(listeners(port).sort(), [child.pid, kid].sort());
  assert.throws(() => assertRunServes(port, REMEDY), new RegExp(`Port ${port} is taken`));
  assert.equal(isServing(child, port, REMEDY), true);
  recordStarted(child, port);
  assertRunServes(port, REMEDY);

  // Neither for another child of ours, nor once the process it descends from has gone.
  const other = await startListener(await freePort());
  assert.throws(
    () => isServing(other, port, REMEDY),
    new RegExp(`pid ${child.pid}, [^]*pid ${kid}, |pid ${kid}, [^]*pid ${child.pid}, `),
  );
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  try {
    await until(() => identityOf(kid)?.ppid === 1, 'the child was never orphaned');
    assert.throws(() => isServing(child, port, REMEDY), new RegExp(`Port ${port} is taken[^]*pid ${kid}, `));
    assert.throws(() => assertRunServes(port, REMEDY), new RegExp(`Port ${port} is taken[^]*pid ${kid}, `));
  } finally {
    process.kill(kid, 'SIGKILL'); // ours: this test started it, and it was alive just now
  }
  endRun();
});

test('a sibling of our server and the process that started it are somebody else', async () => {
  const endRun = beginRun(runs);
  const port = await freePort();
  const { child, kid } = await startForking(port);
  // Recorded: the kid. Its parent listens too, and is not a descendant of it.
  writeFileSync(process.env.MF_E2E_RUN_LEDGER, recordLine({ pid: kid, started: identityOf(kid).started, port }));
  assert.throws(() => assertRunServes(port, REMEDY), new RegExp(`Port ${port} is taken[^]*pid ${child.pid}, `));
  writeFileSync(
    process.env.MF_E2E_RUN_LEDGER,
    recordLine({ pid: child.pid, started: 'Mon Jan  1 00:00:00 2024', port }),
  );
  assert.throws(() => assertRunServes(port, REMEDY), /is taken/);
  writeFileSync(
    process.env.MF_E2E_RUN_LEDGER,
    recordLine({ pid: child.pid, started: identityOf(child.pid).started, port: port + 1 }),
  );
  assert.throws(() => assertRunServes(port, REMEDY), /is taken/);
  endRun();
});

/** Puts a program in place of `name` while `use` runs. */
async function withFake(name, script, use) {
  const bin = mkdtempSync(path.join(dir, 'bin-'));
  writeFileSync(path.join(bin, name), `#!/bin/sh\n${script}\n`);
  chmodSync(path.join(bin, name), 0o755);
  const before = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${before}`;
  try {
    return await use();
  } finally {
    process.env.PATH = before;
  }
}

const CANNOT_TELL = /Cannot tell /;

test('a lookup that fails or answers in part uses nothing and stops nothing', async () => {
  const endRun = beginRun(runs);
  const port = await freePort();
  const child = await startListener(port);
  recordStarted(child, port);
  const refuses = async (what) => {
    assert.throws(() => isServing(child, port, REMEDY), CANNOT_TELL, what);
    assert.throws(() => assertRunServes(port, REMEDY), CANNOT_TELL, what);
    await assert.rejects(ensurePortFree(port, { command: commandOn(port), cwd: dir }, REMEDY), CANNOT_TELL, what);
  };
  for (const [what, script] of [
    ['lsof', `echo ${child.pid}; exit 1`], // as when it read only some of what it was to read
    ['lsof', 'exit 2'],
    ['lsof', 'kill -9 $$'],
    ['ps', 'echo 1; exit 1'],
    ['ps', 'exit 127'],
    ['ps', 'echo what'],
  ]) {
    await withFake(what, script, () => refuses(`${what}: ${script}`));
    await assertSurvives(child.pid);
  }
  endRun();
  await assertGone(child.pid);
});

test('a lookup that finds nothing, with exit 1 and no output, finds nothing', async () => {
  const port = await freePort();
  await withFake('lsof', 'exit 1', () => ensurePortFree(port, undefined, REMEDY));
  const child = await startListener(port);
  await withFake('lsof', 'exit 1', async () => {
    assert.equal(isServing(child, port, REMEDY), false);
    await assert.rejects(ensurePortFree(port, undefined, REMEDY), /is taken/);
  });
  await assertSurvives(child.pid);
});

test('a lookup that hangs is given up', { timeout: 60_000 }, async () => {
  const port = await freePort();
  const child = await startListener(port);
  for (const program of ['lsof', 'ps']) {
    const since = Date.now();
    await withFake(program, 'exec sleep 40', async () => {
      assert.throws(() => isServing(child, port, REMEDY), /Cannot tell [^]*ETIMEDOUT/);
    });
    assert.ok(Date.now() - since < 20_000, program);
  }
});

test('the end of a run stops what it can tell, and keeps the record of what it cannot', async () => {
  const endRun = beginRun(runs);
  const [first, second] = [await freePort(), await freePort()];
  const unknown = await startListener(first);
  const known = await startListener(second);
  recordStarted(unknown, first);
  recordStarted(known, second);
  const real = execFileSync('/bin/sh', ['-c', 'command -v ps'], { encoding: 'utf8' }).trim();
  const script = `case "$*" in *" ${unknown.pid} "*) exit 2;; esac; exec ${real} "$@"`;
  await withFake('ps', script, () => assert.throws(endRun, CANNOT_TELL));
  await assertGone(known.pid);
  await assertSurvives(unknown.pid);
  assert.equal(readdirSync(runs).length, 1);
  endRun();
  await assertGone(unknown.pid);
  assert.deepEqual(readdirSync(runs), []);
});
