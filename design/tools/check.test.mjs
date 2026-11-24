import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { areaForBoard, areaForPath, checkCanvas, checkLocalPaths, loadAreas, localPaths, REPO, uncoveredAreas } from './check.mjs';

const cfg = loadAreas();

test('the most specific code path wins', () => {
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/composer/Composer.tsx').id, 'composer');
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/gates/PermissionGate.tsx').id, 'composer');
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/thread/ChatThread.tsx').id, 'transcript');
  assert.equal(areaForPath(cfg, 'packages/ui/src/layout/WorkspaceTabStrip.tsx').id, 'workspace');
  assert.equal(areaForPath(cfg, 'packages/ui/src/layout/TitleBar.tsx').id, 'shell');
});

test('shared primitives, styles and shared pieces are Foundations, and DESIGN.md is its design file', () => {
  assert.equal(areaForPath(cfg, 'packages/ui/src/components/ui/button.tsx').id, 'foundations');
  assert.equal(areaForPath(cfg, 'packages/ui/src/components/ui/sidebar/menu.tsx').id, 'foundations');
  assert.equal(areaForPath(cfg, 'packages/ui/src/styles/globals.css').id, 'foundations');
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/shared/ErrorState.tsx').id, 'foundations');
  assert.equal(areaForBoard(cfg, 'Foundations-Tokens').id, 'foundations');
  const code = 'packages/ui/src/styles/globals.css';
  assert.deepEqual(uncoveredAreas(cfg, [code]).map((m) => m.area.id), ['foundations']);
  assert.deepEqual(uncoveredAreas(cfg, [code, 'DESIGN.md']), []);
  assert.deepEqual(uncoveredAreas(cfg, [code, 'design/canvas/project/Foundations-Tokens.dc.html']), []);
});

test('only visual files count: logic, docs and tests belong to no area', () => {
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/controller/chat-actions.ts'), null);
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/README.md'), null);
  assert.equal(areaForPath(cfg, 'packages/ui/src/app/main.tsx').id, 'shell');
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/daemon/AddRemoteDialog.tsx').id, 'settings');
});

test('tests and unmapped code belong to no area', () => {
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/composer/__tests__/Composer.test.tsx'), null);
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/composer/segments/segment-model.test.ts'), null);
  assert.equal(areaForPath(cfg, 'packages/core-rs/crates/mainframe-quota/src/codex.rs'), null);
});

test('the most specific board prefix wins', () => {
  assert.equal(areaForBoard(cfg, 'Workspace-SessionPanel').id, 'session-panel');
  assert.equal(areaForBoard(cfg, 'Workspace-Files').id, 'workspace');
  assert.equal(areaForBoard(cfg, 'Shell-SidebarRows').id, 'sidebar');
  assert.equal(areaForBoard(cfg, 'Shell-TitleBar').id, 'shell');
  assert.equal(areaForBoard(cfg, 'Proposal-Redesign-Composer').id, 'proposals');
});

test('a UI change needs its own area board or brief, not a proposal', () => {
  const code = 'packages/ui/src/features/chat/composer/Composer.tsx';
  assert.deepEqual(uncoveredAreas(cfg, [code]).map((m) => m.area.id), ['composer']);
  assert.deepEqual(uncoveredAreas(cfg, [code, 'design/canvas/project/Chat-ComposerMenus.dc.html']), []);
  assert.deepEqual(uncoveredAreas(cfg, [code, 'packages/ui/.impeccable/surfaces/src-features-chat-composer.md']), []);
  assert.deepEqual(uncoveredAreas(cfg, [code, 'design/canvas/project/Proposal-Redesign-Composer.dc.html']).map((m) => m.area.id), ['composer']);
  assert.deepEqual(uncoveredAreas(cfg, [code, 'design/canvas/project/Chat-Thread.dc.html']).map((m) => m.area.id), ['composer']);
});

test('moving or deleting still counts as a code change, but deleting a board is not a design update', () => {
  const code = { status: 'D', path: 'packages/ui/src/features/sessions/SessionRow.tsx' };
  assert.deepEqual(uncoveredAreas(cfg, [code]).map((m) => m.area.id), ['sidebar']);
  assert.deepEqual(uncoveredAreas(cfg, [code, { status: 'D', path: 'design/canvas/project/Shell-SidebarRows.dc.html' }]).map((m) => m.area.id), ['sidebar']);
  assert.deepEqual(uncoveredAreas(cfg, [code, { status: 'A', path: 'design/canvas/project/Shell-SidebarRows.dc.html' }]), []);
});

test('the committed canvas passes', () => {
  assert.deepEqual(checkCanvas(cfg), []);
});

test('the published design files name no local path', () => {
  assert.deepEqual(checkLocalPaths(), []);
});

const python = (code, input, args = []) =>
  execFileSync('python3', ['-c', code, ...args], {
    cwd: join(REPO, 'design/canvas/lib'),
    input,
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
const leaks = (text, names = []) =>
  JSON.parse(
    python('import json,sys; from boards import leaks; print(json.dumps(leaks(sys.stdin.read(), set(sys.argv[1:]))))', text, names),
  );

const PATHS = [
  ['<p title="/Users/jane/Code">x</p>', '/Users/jane/Code'],
  ['<p>/private/tmp/x/y</p>', '/private/tmp/x/y'],
  ['<p>/private/var/folders/x</p>', '/private/var/folders/x'],
  ['<p>/var/folders/y6/abc/T</p>', '/var/folders/y6/abc/T'],
  ['<p>/home/runner/work</p>', '/home/runner/work'],
  ['<p>file:///home/jane/x</p>', '/home/jane/x'],
  ['<p>/tmp/claude-501/x</p>', '/tmp/claude-501/x'],
  ['<p>/tmp/run-Users-jane-Code/x</p>', '/tmp/run-Users-jane-Code/x'],
  ['<p>projects/-Users-jane-Code/x</p>', '-Users-jane-Code/x'],
  ['<a href="x?p=%2FUsers%2Fjane%2FCode">x</a>', '/Users/jane/Code'],
  ['<a href="x?p=%252Fvar%252Ffolders%252Fy6">x</a>', '/var/folders/y6'],
  ['{"p":"\\/Users\\/jane"}', '/Users/jane'],
  ['{"p":"\\u002fUsers\\u002fjane"}', '/Users/jane'],
  ['<p>&#x2F;Users&#47;jane</p>', '/Users/jane'],
  ['<p>C:\\Users\\jane</p>', 'C:\\Users\\jane'],
];
const NEUTRAL = [
  '<p>~/Code/atlas-web</p>',
  '<p>/tmp/release-notes.md</p>',
  '<a href="https://example.com/home/jane">x</a>',
  '<p>src/private/key.ts, /users/1, packages/home/Home.tsx</p>',
  '<svg class="icon-home-x -home"></svg>',
];

test('a local path is found in any spelling, by the CI check and by the board writers alike', () => {
  for (const [text, path] of PATHS) {
    assert.deepEqual(localPaths(text), [path], text);
    assert.deepEqual(leaks(text), [path], text);
  }
  for (const text of NEUTRAL) {
    assert.deepEqual(localPaths(text), [], text);
    assert.deepEqual(leaks(text), [], text);
  }
});

test('the user and host names are looked for in the markup only', () => {
  assert.deepEqual(leaks('<b>janemac.local</b> and janet', ['jane', 'JaneMac']), ['janemac']);
  assert.deepEqual(leaks('<p aria-label="jane’s chat">x</p>', ['jane']), ['jane']);
  const css = '<style>.max{max-width:1px}</style><script>Math.max(1)</script>';
  assert.deepEqual(leaks(`${css}<p class="max-w-64" style="max-width:1px">hello</p>`, ['max']), []);
  assert.deepEqual(leaks(`${css}<p>max</p>`, ['max']), ['max']);
});

test('tool cards and markers are numbered within their own state', () => {
  const { numberIds } = createRequire(import.meta.url)('../canvas/proposals/number-ids.cjs');
  const card = (from) =>
    `<button aria-controls="tc${from}"></button><div id="tc${from}"></div><button aria-controls="mk${from + 1}"></button>` +
    `<div id="mk${from + 1}"></div><div id="wsep1" data-id="mm-k3"></div>`;
  assert.equal(
    numberIds(card(57), 'tools'),
    '<button aria-controls="tools-tc1"></button><div id="tools-tc1"></div><button aria-controls="tools-mk2"></button>' +
      '<div id="tools-mk2"></div><div id="wsep1" data-id="mm-k3"></div>',
  );
  assert.equal(numberIds(card(900), 'tools'), numberIds(card(57), 'tools'));
});

test('no committed proposal board holds an id that depends on the states captured before it', () => {
  const dir = join(REPO, 'design/canvas/project');
  for (const board of readdirSync(dir).filter((name) => name.startsWith('Proposal-Redesign-'))) {
    assert.deepEqual(readFileSync(join(dir, board), 'utf8').match(/"(?:tc|mk)\d+"/g) ?? [], [], board);
  }
});

test('no builder writes a board that holds a local path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'design-check-'));
  try {
    for (const part of ['design/canvas/lib', 'design/canvas/proposals', 'design/redesign']) {
      cpSync(join(REPO, part), join(dir, part), { recursive: true, filter: (from) => !/\/(?:render|__pycache__)$/.test(from) });
    }
    const project = join(dir, 'design/canvas/project');
    const proposals = join(dir, 'design/canvas/proposals');
    mkdirSync(project);
    const run = (html) => {
      const ids = JSON.parse(
        python('import json,sys; sys.path.insert(0, sys.argv[1]); from states import BOARDS; print(json.dumps([s["id"] for b in BOARDS for s in b["states"]]))', '', [proposals]),
      );
      const frame = { html, w: 100, h: 100 };
      const frags = Object.fromEntries([...ids, '__sprite'].map((id) => [id, frame]));
      writeFileSync(join(proposals, 'frags.json'), JSON.stringify(frags));
      execFileSync('python3', [join(proposals, 'build.py')], { stdio: 'pipe', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    };
    assert.throws(() => run('<p title="/Users/jane/Code">x</p>'), /the board names this machine, not written: \/Users\/jane\/Code/);
    assert.deepEqual(readdirSync(project), []);
    run('<p title="~/Code">x</p>');
    assert.ok(readdirSync(project).includes('Proposal-Redesign-Spec.dc.html'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A stand-in daemon: answers every request and leaves its environment in its data dir. */
const FAKE_DAEMON = `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(process.env.MAINFRAME_DATA_DIR + '/env.json', JSON.stringify(process.env));
require('node:http').createServer((req, res) => res.end('{}')).listen(Number(process.env.DAEMON_PORT), '127.0.0.1');
`;

const freePort = () =>
  new Promise((done) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(String(port)));
    });
  });

test('a capture’s daemon gets an empty HOME and none of the machine’s tokens; the e2e suite’s keeps its environment', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'design-check-'));
  const fake = join(dir, 'fake-daemon');
  writeFileSync(fake, FAKE_DAEMON);
  chmodSync(fake, 0o755);
  const secrets = { GH_TOKEN: 'x', ANTHROPIC_API_KEY: 'x', SOME_NEW_SECRET: 'x', CLAUDE_CONFIG_DIR: '/x', CODEX_HOME: '/x', XDG_CONFIG_HOME: '/x' };
  const before = { ...process.env };
  Object.assign(process.env, secrets, { MF_E2E_RUST_DAEMON_PATH: fake, MF_E2E_DAEMON_PORT: await freePort() });
  delete process.env.E2E_MODE;
  try {
    const { startDaemon } = await import('../../packages/e2e/fixtures/daemon.ts');
    const { isolated } = await import('../canvas/capture/isolation.mts');
    const envOf = async (options) => {
      const { daemon, testDataDir } = await startDaemon(options);
      const gone = new Promise((done) => daemon.once('exit', done));
      daemon.kill();
      await gone;
      return JSON.parse(readFileSync(join(testDataDir, 'env.json'), 'utf8'));
    };

    const launch = isolated({ mockFork: true }, 3, dir);
    assert.equal(launch.mockFork, true);
    assert.deepEqual(readdirSync(launch.dataDir), []);
    const captured = await envOf(launch);
    assert.equal(captured.HOME, launch.home);
    assert.deepEqual(readdirSync(launch.home), []);
    assert.equal(captured.PATH, process.env.PATH);
    for (const name of Object.keys(secrets)) assert.equal(captured[name], undefined, name);

    const suiteDir = join(dir, 'suite');
    mkdirSync(suiteDir);
    const suite = await envOf({ dataDir: suiteDir });
    assert.equal(suite.HOME, process.env.HOME);
    assert.equal(suite.GH_TOKEN, 'x');
    assert.ok(existsSync(join(suiteDir, 'daemon.log')));
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in before)) delete process.env[name];
    Object.assign(process.env, before);
    rmSync(dir, { recursive: true, force: true });
  }
});
