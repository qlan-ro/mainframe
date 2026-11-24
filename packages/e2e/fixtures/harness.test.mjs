// The fixtures in throwaway worktrees, against stand-ins for the daemon and vite, on ports the system handed out.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertGone, assertSurvives, freePort, until } from './port-guard.helpers.mjs';

const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let root;

before(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'harness-')));
});
after(() => rmSync(root, { recursive: true, force: true }));

// Loaded into every process of a scenario: acts in the stand-ins alone. `FAKE` says how, per server.
const STAND_IN = `
const fs = require('fs');
const daemon = process.argv0.endsWith('mainframe-daemon');
if (daemon || /vite.js$/.test(process.argv[1] ?? '')) {
  const name = daemon ? 'daemon' : 'vite';
  const act = JSON.parse(process.env.FAKE || '{}')[name];
  const log = (what) => fs.appendFileSync(process.env.FAKE_LOG, [name, process.pid, what].join(' ') + '\\n');
  setTimeout(() => process.exit(), 90_000); // a failed test leaves nothing for long
  const port = daemon ? process.env.DAEMON_PORT : process.argv[process.argv.indexOf('--port') + 1];
  const listen = () => {
    const server = require('http').createServer((req, res) => {
      log(req.method + ' ' + req.url);
      res.end('{"data":[{"id":"mock-cli","installed":true}]}');
    });
    server.on('error', (error) => process.exit(error.code === 'EADDRINUSE' ? 98 : 1));
    server.listen(Number(port), '127.0.0.1');
  };
  log('started');
  if (act === 'exit') process.exit(3);
  else if (act === 'slow') setTimeout(listen, 2500);
  else if (act !== 'silent') listen();
}
`;

/** A worktree with the real fixtures and nothing else. */
function worktree(name) {
  const dir = path.join(root, name);
  const e2e = path.join(dir, 'packages/e2e');
  const vite = path.join(dir, 'packages/ui/node_modules/vite');
  const target = path.join(dir, 'packages/core-rs/target/release');
  for (const each of [e2e, path.join(vite, 'bin'), path.join(dir, 'packages/ui/dist/assets'), target]) {
    mkdirSync(each, { recursive: true });
  }
  cpSync(path.join(E2E, 'fixtures'), path.join(e2e, 'fixtures'), {
    recursive: true,
    filter: (from) => !from.endsWith('recordings'),
  });
  symlinkSync(path.join(E2E, 'node_modules'), path.join(e2e, 'node_modules'));
  writeFileSync(path.join(e2e, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(dir, 'packages/ui/package.json'), '{}');
  writeFileSync(path.join(vite, 'package.json'), '{"name":"vite"}');
  writeFileSync(path.join(vite, 'bin/vite.js'), '');
  symlinkSync(process.execPath, path.join(target, 'mainframe-daemon'));
  writeFileSync(path.join(dir, 'stand-in.cjs'), STAND_IN);
  return dir;
}

/** Runs `code` in the worktree's e2e package. Resolves with what it printed and its exit code. */
async function run(dir, code, env = {}) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: path.join(dir, 'packages/e2e'),
    env: {
      ...process.env,
      E2E_MODE: 'mock',
      MF_E2E_SKIP_BUILD: '1',
      MF_E2E_RUST_DAEMON_PATH: path.join(dir, 'packages/core-rs/target/release/mainframe-daemon'),
      NODE_OPTIONS: `--require ${path.join(dir, 'stand-in.cjs')}`,
      FAKE_LOG: path.join(dir, 'log'),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.on('data', (data) => (output += data));
  const [exitCode] = await once(child, 'close');
  return { output, exitCode };
}

async function ports(dir) {
  const [daemon, preview] = [await freePort(), await freePort()];
  if (dir) writeFileSync(path.join(dir, 'packages/ui/dist/assets/app.js'), String(daemon));
  return { daemon, preview, env: { MF_E2E_DAEMON_PORT: String(daemon), MF_E2E_PREVIEW_PORT: String(preview) } };
}

const logOf = (dir) => (existsSync(path.join(dir, 'log')) ? readFileSync(path.join(dir, 'log'), 'utf8') : '');
const pidOf = (dir, name) => Number(new RegExp(`^${name} (\\d+) started`, 'm').exec(logOf(dir))?.[1]);

/** A server of somebody else, in this process: what it is asked is what the harness sent it. */
async function foreignServer(port) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.end('{}');
  }).listen(port, '127.0.0.1');
  await once(server, 'listening');
  return { requests, close: () => new Promise((done) => (server.close(done), server.closeAllConnections())) };
}

const START_DAEMON = `
  const { beginRun } = await import('./fixtures/port-guard.ts');
  const { startDaemon } = await import('./fixtures/daemon.ts');
  const endRun = beginRun();
`;
const SETUP = `const setup = (await import('./fixtures/global-setup.ts')).default;`;

test('a run that names the installed app’s port, or no port, stops at load', async () => {
  const dir = worktree('reserved');
  for (const [name, file] of [
    ['MF_E2E_DAEMON_PORT', 'daemon.ts'],
    ['MF_E2E_PREVIEW_PORT', 'global-setup.ts'],
  ]) {
    // Loads the module and starts nothing, so nothing dials the port whatever the module does.
    for (const value of ['31415', '031415', ' 31415', '31415.0', '0x7ab7', '', 'abc', '99999']) {
      const { output, exitCode } = await run(dir, `await import('./fixtures/${file}')`, { [name]: value });
      assert.notEqual(exitCode, 0, `${name}=${value}`);
      assert.match(output, new RegExp(`${name}(=".*" is not a port| must not be 31415)`));
    }
  }
  const same = await run(dir, SETUP, { MF_E2E_DAEMON_PORT: '40000', MF_E2E_PREVIEW_PORT: '40000' });
  assert.match(same.output, /need a port each/);
});

test('a retry stops the daemon its dead worker left', async () => {
  const dir = worktree('retry');
  const { env } = await ports(dir);
  const { output, exitCode } = await run(
    dir,
    `${START_DAEMON}
    const first = await startDaemon();
    const gone = new Promise((done) => first.daemon.once('exit', (code, signal) => done(signal)));
    await startDaemon();
    console.log('first:', await gone);
    endRun();`,
    env,
  );
  assert.equal(exitCode, 0, output);
  assert.match(output, /first: SIGKILL/);
  assert.match(logOf(dir), /PUT \/api\/settings\/providers\/claude/);
});

test('the end of a run stops its preview', async () => {
  const dir = worktree('teardown');
  const { env } = await ports(dir);
  const { output, exitCode } = await run(
    dir,
    `${SETUP} const teardown = await setup(); await teardown(); process.exit();`,
    env,
  );
  assert.equal(exitCode, 0, output);
  assert.match(logOf(dir), /^vite \d+ GET \/$/m);
  await assertGone(pidOf(dir, 'vite'));
});

test('a killed run’s orphan is stopped by the next one, unless its daemon is from outside the worktree', async () => {
  const crash = `${START_DAEMON} await startDaemon(); process.kill(process.pid, 'SIGKILL');`;
  const next = `${START_DAEMON} await startDaemon().then(() => console.log('started'), (e) => console.log(e.message)); endRun();`;

  const inside = worktree('inside');
  const { env } = await ports(inside);
  await run(inside, crash, env);
  const orphan = pidOf(inside, 'daemon');
  await assertSurvives(orphan);
  assert.match((await run(inside, next, env)).output, /^started$/m);
  await assertGone(orphan);

  const outside = worktree('outside');
  const shared = path.join(worktree('shared'), 'packages/core-rs/target/release/mainframe-daemon');
  const other = { ...(await ports(outside)).env, MF_E2E_RUST_DAEMON_PATH: shared };
  await run(outside, crash, other);
  const left = pidOf(outside, 'daemon');
  const { output } = await run(outside, next, other);
  assert.match(output, new RegExp(`is taken[^]*pid ${left}, `));
  await assertSurvives(left);
  process.kill(left, 'SIGKILL'); // ours: this test started it, and it was alive just now
});

test('a server that takes the port while ours starts is never asked anything', async () => {
  for (const [name, code] of [
    ['daemon', `${START_DAEMON} await startDaemon().catch((e) => console.log(e.message)).finally(endRun);`],
    ['vite', `${SETUP} await setup().catch((e) => console.log(e.message));`],
  ]) {
    for (const act of ['silent', 'exit']) {
      const dir = worktree(`${name}-${act}`);
      const { daemon, preview, env } = await ports(dir);
      const running = run(dir, code, { ...env, FAKE: JSON.stringify({ [name]: act }) });
      await until(() => pidOf(dir, name), `${name} never started`);
      const foreign = await foreignServer(name === 'daemon' ? daemon : preview);
      const { output } = await running;
      await foreign.close();
      assert.match(output, act === 'exit' ? /exited \(code 3\)|is taken by/ : /is taken by/);
      assert.deepEqual(foreign.requests, [], `${name} ${act}`);
      assert.ok(act === 'exit' || output.includes(`pid ${process.pid}, `), output);
      await assertGone(pidOf(dir, name));
    }
  }
});

test('of two worktrees that start on one port together, one is refused and only the other’s daemon is used', async () => {
  const dirs = [worktree('one'), worktree('two')];
  const { env } = await ports();
  // Both find the port free: neither listens until both have started.
  const code = `${START_DAEMON}
    const started = await startDaemon().then(() => true, (e) => (console.log(e.message), false));
    if (started) console.log('won');
    await new Promise((r) => setTimeout(r, 1500));
    endRun();
    process.exit();`;
  const results = await Promise.all(dirs.map((dir) => run(dir, code, { ...env, FAKE: '{"daemon":"slow"}' })));
  const winners = results.map(({ output }) => /^won$/m.test(output));
  assert.deepEqual([...winners].sort(), [false, true], JSON.stringify(results));
  const [won, lost] = winners[0] ? [0, 1] : [1, 0];
  assert.match(results[lost].output, /is taken by a process this run did not start|exited \(code 98\)/);
  assert.equal(logOf(dirs[won]).match(/PUT/g).length, 1);
  assert.doesNotMatch(logOf(dirs[lost]), /GET|PUT/);
});

test('a run whose daemon or preview port is taken stops before it builds', async () => {
  for (const which of ['daemon', 'preview']) {
    const dir = worktree(`taken-${which}`);
    const held = await ports(dir);
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'pnpm'), `#!/bin/sh\ntouch "${dir}/built"\n`);
    chmodSync(path.join(bin, 'pnpm'), 0o755);
    const env = { ...held.env, MF_E2E_SKIP_BUILD: '', PATH: `${bin}:${process.env.PATH}` };

    const foreign = await foreignServer(held[which]);
    const refused = await run(dir, `${SETUP} await setup();`, env);
    await foreign.close();
    assert.notEqual(refused.exitCode, 0);
    assert.match(refused.output, new RegExp(`Port ${held[which]} is taken[^]*pid ${process.pid}, `));
    assert.deepEqual(foreign.requests, []);
    assert.ok(!existsSync(path.join(dir, 'built')));

    const { exitCode, output } = await run(dir, `${SETUP} await (await setup())(); process.exit();`, env);
    assert.equal(exitCode, 0, output);
    assert.ok(existsSync(path.join(dir, 'built')));
  }
});
