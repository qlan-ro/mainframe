// Every process here is one the test itself starts, on a port the system handed out as free.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import { beginRun, ensurePortFree, recordStarted } from './port-guard.ts';

const REMEDY = 'Use another port';
/** Children, whose handles cannot signal a reused pid. */
const started = new Set();
let dir;
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
afterEach(() => {
  for (const child of started) child.kill('SIGKILL');
  started.clear();
});
after(() => rmSync(dir, { recursive: true, force: true }));

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function assertGone(pid) {
  for (let attempt = 0; alive(pid); attempt++) {
    assert.ok(attempt < 100, `pid ${pid} is still running`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

const commandOn = (port) => [process.execPath, script, String(port)].join(' ');

async function startListener(port) {
  const child = spawn(process.execPath, [script, String(port)], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  started.add(child);
  await once(child.stdout, 'data');
  return child.pid;
}

/** A listener whose parent has exited. */
async function startOrphan(port) {
  const code =
    `const c = require('child_process').spawn(process.execPath, [${JSON.stringify(script)}, '${port}'],` +
    ` { cwd: ${JSON.stringify(dir)}, stdio: 'ignore', detached: true }); console.log(c.pid); c.unref();`;
  const pid = Number(execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' }));
  for (let attempt = 0; attempt < 50; attempt++) {
    const socket = connect(port, '127.0.0.1');
    const open = await once(socket, 'connect').then(
      () => true,
      () => false,
    );
    socket.destroy();
    if (open) return pid;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the orphan never listened');
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
  assert.ok(alive(pid), 'the process must be left running');
}

test('a free port is free', async () => {
  await ensurePortFree(await freePort(), undefined, REMEDY);
});

test('a process this run did not start is named and left running, whatever it is called', async () => {
  const endRun = beginRun();
  const port = await freePort();
  await assertRefused(port, await startListener(port));
  endRun();
});

test('a process that only talks to the port is left running', async () => {
  const endRun = beginRun();
  const port = await freePort();
  const pid = await startListener(port);
  recordStarted(pid);
  const code = `require('net').connect(${port}, '127.0.0.1', () => console.log('up')).on('error', () => {}); setInterval(() => {}, 1000);`;
  const client = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'] });
  started.add(client);
  await once(client.stdout, 'data');
  await ensurePortFree(port, undefined, REMEDY);
  assert.ok(alive(client.pid));
  endRun();
});

test('a process this run recorded is stopped and the port is free', async () => {
  const endRun = beginRun();
  const port = await freePort();
  const pid = await startListener(port);
  recordStarted(pid);
  await ensurePortFree(port, undefined, REMEDY);
  await assertGone(pid);
  endRun();
});

test('an earlier run’s record does not count, and a reused pid does not either', async () => {
  const endFirst = beginRun();
  const port = await freePort();
  const pid = await startListener(port);
  recordStarted(pid);
  const ledger = process.env.MF_E2E_RUN_LEDGER;
  assert.equal(JSON.parse(readFileSync(ledger, 'utf8')).pid, pid);

  const endSecond = beginRun();
  await assertRefused(port, pid);
  endSecond();

  process.env.MF_E2E_RUN_LEDGER = ledger;
  writeFileSync(ledger, `${JSON.stringify({ pid, started: 'Mon Jan  1 00:00:00 2024' })}\n`);
  await assertRefused(port, pid);
  endFirst();
  assert.ok(alive(pid));
});

test('only this worktree’s own orphan is stopped: same command, same directory, no parent left', async () => {
  const endRun = beginRun();
  const port = await freePort();
  const own = { command: commandOn(port), cwd: dir };

  const parented = await startListener(port);
  await assertRefused(port, parented, own);
  for (const child of started) child.kill('SIGKILL');
  await assertGone(parented);

  const orphan = await startOrphan(port);
  await assertRefused(port, orphan, { ...own, cwd: tmpdir() });
  await assertRefused(port, orphan, { ...own, command: `${own.command} --other` });
  await ensurePortFree(port, own, REMEDY);
  await assertGone(orphan);
  endRun();
});

test('the end of a run stops what the run recorded and nothing else', async () => {
  const endRun = beginRun();
  const [ownPort, otherPort] = [await freePort(), await freePort()];
  const own = await startListener(ownPort);
  const other = await startListener(otherPort);
  recordStarted(own);
  endRun();
  await assertGone(own);
  assert.ok(alive(other));
});

test('the harness refuses a taken daemon or preview port, and stops nothing', async () => {
  const before = { ...process.env };
  const [daemonPort, previewPort] = [await freePort(), await freePort()];
  Object.assign(process.env, {
    MF_E2E_DAEMON_PORT: String(daemonPort),
    MF_E2E_PREVIEW_PORT: String(previewPort),
    MF_E2E_RUST_DAEMON_PATH: script,
  });
  const endRun = beginRun();
  try {
    const { startDaemon } = await import('./daemon.ts');
    const { startPreview } = await import('./global-setup.ts');
    for (const [port, start] of [
      [daemonPort, startDaemon],
      [previewPort, startPreview],
    ]) {
      const pid = await startListener(port);
      await assert.rejects(start(), new RegExp(`Port ${port} is taken[^]*pid ${pid}, `));
      assert.ok(alive(pid));
    }
  } finally {
    endRun();
    for (const name of Object.keys(process.env)) if (!(name in before)) delete process.env[name];
    Object.assign(process.env, before);
  }
});
