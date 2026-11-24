import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { areaForBoard, areaForPath, checkCanvas, loadAreas, REPO, uncoveredAreas } from './check.mjs';

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

test('a captured board that names the machine it was drawn on is refused', () => {
  const leaks = (text) =>
    JSON.parse(
      execFileSync(
        'python3',
        ['-c', 'import json,sys; from boards import leaks; print(json.dumps(leaks(sys.stdin.read(), {"jane", "JaneMac"})))'],
        { cwd: join(REPO, 'design/canvas/lib'), input: text, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
      ),
    );
  assert.deepEqual(leaks('<p>~/Code/atlas-web</p>'), []);
  assert.deepEqual(leaks('<p title="/Users/jane/Code">x</p>'), ['/Users/jane/Code', 'jane']);
  assert.deepEqual(leaks('<p>/private/var/folders/x</p>'), ['/private/var/folders/x']);
  assert.deepEqual(leaks('<p>/home/runner/work</p>'), ['/home/runner/work']);
  assert.deepEqual(leaks('<b>janemac.local</b> and janet'), ['janemac']);
});

test('the capture runs the daemon on a HOME of its own, and the e2e suite keeps the real one', async () => {
  const { daemonBaseEnv } = await import('../../packages/e2e/fixtures/daemon.ts');
  assert.deepEqual(daemonBaseEnv(), { ...process.env });
  const before = { ...process.env };
  Object.assign(process.env, { CLAUDE_CONFIG_DIR: '/x', CODEX_HOME: '/x', XDG_CONFIG_HOME: '/x' });
  const env = daemonBaseEnv('/tmp/capture-home');
  for (const name of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME']) {
    assert.equal(env[name], undefined);
    if (before[name] === undefined) delete process.env[name];
    else process.env[name] = before[name];
  }
  assert.equal(env.HOME, '/tmp/capture-home');
  assert.equal(env.PATH, process.env.PATH);

  const spec = readFileSync(join(REPO, 'design/canvas/capture/capture.spec.mts'), 'utf8');
  assert.match(spec, /home: captureHome\(\)/);
});
