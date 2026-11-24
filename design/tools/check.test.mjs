import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areaForBoard, areaForPath, checkCanvas, loadAreas, uncoveredAreas } from './check.mjs';

const cfg = loadAreas();

test('the most specific code path wins', () => {
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/composer/Composer.tsx').id, 'composer');
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/gates/PermissionGate.tsx').id, 'composer');
  assert.equal(areaForPath(cfg, 'packages/ui/src/features/chat/thread/ChatThread.tsx').id, 'transcript');
  assert.equal(areaForPath(cfg, 'packages/ui/src/layout/WorkspaceTabStrip.tsx').id, 'workspace');
  assert.equal(areaForPath(cfg, 'packages/ui/src/layout/TitleBar.tsx').id, 'shell');
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

test('the committed canvas passes', () => {
  assert.deepEqual(checkCanvas(cfg), []);
});
