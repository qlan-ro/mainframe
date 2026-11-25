// The fixtures in throwaway worktrees, against stand-ins for the daemon and vite, on ports the system handed out.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
      const body = '{"data":[{"id":"mock-cli","installed":true}]}';
      // "leaves GET /path": answers that request only once somebody else listens on its port.
      if (!act?.startsWith('leaves ' + req.method + ' ' + req.url)) return res.end(body);
      server.close();
      log('left');
      const taken = setInterval(() => {
        if (!fs.existsSync(process.env.FAKE_LOG + '.taken')) return;
        clearInterval(taken);
        res.end(body, () => act.endsWith('and exits') && process.exit(3));
      }, 20);
    });
    process.on('SIGUSR2', () => (server.close(), server.closeAllConnections(), log('left')));
    server.on('error', (error) => process.exit(error.code === 'EADDRINUSE' ? 98 : 1));
    server.listen(Number(port), '127.0.0.1');
  };
  log('started');
  if (act === 'exit') process.exit(3);
  else if (act === 'slow') setTimeout(listen, 2500);
  else if (act !== 'silent') listen();
}
`;

// The helpers import each other as Playwright does: `x.js` for x.ts.
const RESOLVE_TS = `
require('module').registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.') || !specifier.endsWith('.js')) throw error;
      return next(specifier.slice(0, -3) + '.ts', context);
    }
  },
});
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
  for (const each of ['fixtures', 'helpers']) {
    cpSync(path.join(E2E, each), path.join(e2e, each), {
      recursive: true,
      filter: (from) => !from.endsWith('recordings'),
    });
  }
  symlinkSync(path.join(E2E, 'node_modules'), path.join(e2e, 'node_modules'));
  writeFileSync(path.join(e2e, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(dir, 'packages/ui/package.json'), '{}');
  writeFileSync(path.join(vite, 'package.json'), '{"name":"vite"}');
  writeFileSync(path.join(vite, 'bin/vite.js'), '');
  symlinkSync(process.execPath, path.join(target, 'mainframe-daemon'));
  writeFileSync(path.join(dir, 'stand-in.cjs'), STAND_IN + RESOLVE_TS);
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
  const stuck = setTimeout(() => child.kill('SIGKILL'), 45_000); // a run that should have ended fails its test
  const [exitCode] = await once(child, 'close');
  clearTimeout(stuck);
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
/** Takes the port once the stand-in has left it, and tells the stand-in so. */
async function takeOver(dir, name, port) {
  await until(() => new RegExp(`^${name} \\d+ left`, 'm').test(logOf(dir)), `${name} never left its port`);
  const foreign = await foreignServer(port);
  writeFileSync(path.join(dir, 'log.taken'), '');
  return foreign;
}

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
    endRun();
    process.exit();`,
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

test('a server that cannot be recorded does not outlive its start', async () => {
  for (const [name, code] of [
    ['daemon', `${START_DAEMON} await startDaemon().catch((e) => console.log(e.message)); endRun(); process.exit();`],
    ['vite', `${SETUP} await setup().catch((e) => console.log(e.message)); process.exit();`],
  ]) {
    const dir = worktree(`unrecorded-${name}`);
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    // Knows the harness alone.
    const script = `#!/bin/sh\ncase " $* " in *" $PPID "*) exec /bin/ps "$@";; esac\nexit 2\n`;
    writeFileSync(path.join(bin, 'ps'), script);
    chmodSync(path.join(bin, 'ps'), 0o755);
    const { env } = await ports(dir);
    const { output } = await run(dir, code, { ...env, PATH: `${bin}:${process.env.PATH}` });
    assert.match(output, /Cannot tell [^]*ps .*exit 2/);
    // Killed before it wrote its first line, or after.
    if (pidOf(dir, name)) await assertGone(pidOf(dir, name));
    const left = execFileSync('/bin/ps', ['-Aww', '-o', 'command='], { encoding: 'utf8' });
    assert.ok(!left.split('\n').some((line) => line.includes(dir)), left);
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

test('every request of a starting daemon is checked, not only the first', async () => {
  for (const request of ['GET /api/projects', 'GET /api/adapters']) {
    for (const then of ['', ' and exits']) {
      const dir = worktree(`leaves-${request.replace(/\W+/g, '-')}${then.replace(/ /g, '-')}`);
      const { daemon, env } = await ports(dir);
      const code = `${START_DAEMON} await startDaemon().then(() => console.log('started'), (e) => console.log(e.message)); endRun();`;
      const running = run(dir, code, { ...env, FAKE: JSON.stringify({ daemon: `leaves ${request}${then}` }) });
      const foreign = await takeOver(dir, 'daemon', daemon);
      const { output } = await running;
      await foreign.close();
      assert.deepEqual(foreign.requests, [], `${request}${then}`);
      assert.doesNotMatch(output, /started$/m);
      assert.match(output, /is taken by a process this run did not start|exited \(code 3\)/);
    }
  }
});

test('a worker ends when its daemon dies, but not when it stops it', async () => {
  const dir = worktree('dies');
  const { env } = await ports(dir);
  const idle = `await new Promise((r) => setTimeout(r, 20_000)); console.log('went on');`;
  const started = `(await import('node:fs')).appendFileSync(process.env.FAKE_LOG, 'worker started\\n');`;
  const running = run(dir, `${START_DAEMON} await startDaemon(); ${started} ${idle}`, env);
  await until(() => /^worker started$/m.test(logOf(dir)), 'the daemon never started');
  process.kill(pidOf(dir, 'daemon'), 'SIGKILL'); // ours: this test started it
  const { output, exitCode } = await running;
  assert.equal(exitCode, 1, output);
  assert.match(output, /The daemon exited \(SIGKILL\), so this worker ends/);
  assert.doesNotMatch(output, /went on/);

  const stops = worktree('stops');
  const stopped = await run(
    stops,
    `${START_DAEMON}
    const { stopDaemon } = await import('./fixtures/daemon.ts');
    for (let i = 0; i < 2; i++) await stopDaemon(await startDaemon());
    await new Promise((r) => setTimeout(r, 500));
    console.log('went on');
    endRun();`,
    (await ports(stops)).env,
  );
  assert.equal(stopped.exitCode, 0, stopped.output);
  assert.match(stopped.output, /went on/);
});

/** Every way a helper reaches the daemon, against a port that somebody else has taken from a daemon still alive. */
const HELPERS = {
  createTauriProject: `(await import('./helpers/tauri/setup.ts')).createTauriProject()`,
  createTauriChat: `(await import('./helpers/tauri/setup.ts')).createTauriChat({}, 'p')`,
  createTauriAutomation: `(await import('./helpers/tauri/setup.ts')).createTauriAutomation({ name: 'a' })`,
  createHeadlessProject: `(await import('./helpers/tauri/headless-chat.ts')).createHeadlessProject()`,
  createHeadlessChat: `(await import('./helpers/tauri/headless-chat.ts')).createHeadlessChat('p')`,
  openSocket: `(await import('./helpers/tauri/raw-ws-client.ts')).openSocket('/acp/mock-cli')`,
  daemonFetch: `daemon.daemonFetch('/api/settings/providers', { method: 'PUT' })`,
  fetchRoute: `daemon.fetchRoute({ fetch: () => fetch(daemon.DAEMON_BASE + '/api/chats') })`,
  ws: `(async () => {
    let handler;
    const { installWsControl } = await import('./helpers/tauri/ws-control.ts');
    await installWsControl({ routeWebSocket: async (_, each) => (handler = each) });
    handler({ url: () => 'ws://x/acp/y', connectToServer: () => console.log('connected') });
  })()`,
  historyWire: `(async () => {
    let handler;
    const { HistoryWire } = await import('./helpers/tauri/windowed-history.ts');
    await new HistoryWire().install({ routeWebSocket: async (_, each) => (handler = each) });
    handler({ connectToServer: () => console.log('connected') });
  })()`,
};

test('no helper asks a server that took the daemon’s port', async () => {
  const dir = worktree('helpers-taken');
  const { daemon, env } = await ports(dir);
  const calls = Object.entries(HELPERS).map(
    ([name, call]) =>
      `await ${call}.then(() => console.log('${name}: asked'), (e) => console.log('${name}:', e.message));`,
  );
  const running = run(
    dir,
    `${START_DAEMON}
    const daemon = await import('./fixtures/daemon.ts');
    const { existsSync } = await import('node:fs');
    const handle = await startDaemon();
    handle.daemon.kill('SIGUSR2');
    while (!existsSync(process.env.FAKE_LOG + '.taken')) await new Promise((r) => setTimeout(r, 20));
    ${calls.join('\n')}
    endRun();
    process.exit();`,
    { ...env, HOME: dir },
  );
  const foreign = await takeOver(dir, 'daemon', daemon);
  const { output } = await running;
  await foreign.close();
  assert.deepEqual(foreign.requests, [], output);
  assert.doesNotMatch(output, /connected/);
  for (const name of Object.keys(HELPERS)) {
    assert.match(output, new RegExp(`^${name}: Port ${daemon} is taken by a process this run did not start`, 'm'));
  }
});

test('a page is never loaded from a server that took the preview’s port', async () => {
  const dir = worktree('preview-taken');
  const { preview, env } = await ports(dir);
  const running = run(
    dir,
    `${SETUP}
    const { existsSync } = await import('node:fs');
    const { chromium } = await import('@playwright/test');
    const { PREVIEW_BASE } = await import('./fixtures/global-setup.ts');
    // Loads the page as a browser would, and nothing else.
    const page = { on() {}, goto: async () => { await fetch(PREVIEW_BASE); throw new Error('loaded'); } };
    const context = { addInitScript: async () => {}, newPage: async () => page, close: async () => {} };
    chromium.launch = async () => ({ isConnected: () => true, newContext: async () => context, close: async () => {} });
    const { launchTauriApp } = await import('./fixtures/app-tauri.ts');
    const launch = () => launchTauriApp().catch((e) => console.log(e.message));
    const teardown = await setup();
    await launch();
    while (!existsSync(process.env.FAKE_LOG + '.taken')) await new Promise((r) => setTimeout(r, 20));
    await launch();
    await teardown();
    process.exit();`,
    env,
  );
  await until(() => /^daemon \d+ PUT/m.test(logOf(dir)), 'no daemon was started');
  await until(() => (logOf(dir).match(/^vite \d+ GET/gm) ?? []).length >= 2, 'the first page never loaded');
  process.kill(pidOf(dir, 'vite'), 'SIGUSR2'); // ours: this test started it
  const foreign = await takeOver(dir, 'vite', preview);
  const { output } = await running;
  await foreign.close();
  assert.match(output, /^loaded$/m);
  assert.match(output, new RegExp(`^Port ${preview} is taken by a process this run did not start`, 'm'));
  assert.deepEqual(foreign.requests, []);
});

test('a run ends when its preview dies, but not when it stops it', async () => {
  const dir = worktree('preview-dies');
  const { env } = await ports(dir);
  const running = run(
    dir,
    `${SETUP} await setup(); process.on('SIGINT', () => { console.log('interrupted'); process.exit(7); }); setInterval(() => {}, 1000);`,
    env,
  );
  await until(() => /^vite \d+ GET/m.test(logOf(dir)), 'the preview never started');
  await new Promise((r) => setTimeout(r, 500));
  process.kill(pidOf(dir, 'vite'), 'SIGKILL'); // ours: this test started it
  const { output, exitCode } = await running;
  assert.equal(exitCode, 7, output);
  assert.match(output, /The preview exited \(SIGKILL\), so the run ends/);

  const stops = worktree('preview-stops');
  const stopped = await run(
    stops,
    `${SETUP} await (await setup())(); await new Promise((r) => setTimeout(r, 500)); console.log('went on'); process.exit();`,
    (await ports(stops)).env,
  );
  assert.equal(stopped.exitCode, 0, stopped.output);
  assert.match(stopped.output, /went on/);
});

/** What reaches a server from the harness's own process, not from the page. */
const REQUEST =
  /(?<!\w)(?:fetch\(|\w+\.fetch\(|request\.(?:get|post|put|patch|delete|head|fetch)\(|new WebSocket\(|connectToServer\()/g;
/** Where one may be, and after which check: a check right before it, or a server of the test's own. */
const CHECKED = {
  'packages/e2e/helpers/tauri/raw-ws-client.ts': ['assertOwnDaemon();'],
  'packages/e2e/helpers/tauri/ws-control.ts': ['assertOwnDaemon();'],
  'packages/e2e/helpers/tauri/windowed-history.ts': ['assertOwnDaemon();'],
  'design/canvas/capture/areas/sidebar.mts': ['assertOwnDaemon();'],
};
/** Requests of the page itself, to a server of the test's own or to a URL of the page. */
const OF_THE_PAGE = [
  'packages/e2e/tests-tauri/windowed-history-measurement.spec.ts',
  'design/canvas/capture/serialise.mts',
];

test('specs, helpers and the capture ask the daemon only through the checked functions', () => {
  const repo = path.resolve(E2E, '../..');
  const files = ['packages/e2e/tests-tauri', 'packages/e2e/helpers', 'design/canvas/capture'].flatMap((folder) =>
    readdirSync(path.join(repo, folder), { recursive: true })
      .filter((name) => /\.m?ts$/.test(name))
      .map((name) => path.posix.join(folder, name.split(path.sep).join('/'))),
  );
  assert.ok(files.length > 50, String(files.length));
  const found = [];
  for (const file of files) {
    if (OF_THE_PAGE.includes(file)) continue;
    const text = readFileSync(path.join(repo, file), 'utf8');
    const lines = text.split('\n').map((line) => line.replace(/(^|\s)\/\/.*|^\s*\*.*/, ''));
    lines.forEach((line, i) => {
      if (!line.match(REQUEST)) return;
      if (CHECKED[file]?.includes(lines[i - 1].trim())) return;
      found.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(found, []);
});
