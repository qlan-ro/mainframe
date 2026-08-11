import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayId, matchesDefinition, isLiveReference, analyze } from '../analyze.mjs';

test('displayId renders the ellipsis marker for a templated definition', () => {
  assert.equal(displayId({ prefix: 'daemon-row-', templated: true }), 'daemon-row-${…}');
});

test('displayId renders the bare id for a static definition', () => {
  assert.equal(displayId({ prefix: 'chat-send-button', templated: false }), 'chat-send-button');
});

test('matchesDefinition requires exact equality for a static definition', () => {
  const def = { prefix: 'chat-send-button', templated: false };
  assert.equal(matchesDefinition(def, 'chat-send-button'), true);
  assert.equal(matchesDefinition(def, 'chat-send-buttonX'), false);
});

test('matchesDefinition matches a templated definition by prefix, including the bare prefix itself', () => {
  const def = { prefix: 'daemon-row-', templated: true };
  assert.equal(matchesDefinition(def, 'daemon-row-abc'), true);
  assert.equal(matchesDefinition(def, 'daemon-row-'), true);
  assert.equal(matchesDefinition(def, 'daemon-rowabc'), false);
});

test('isLiveReference is true when a definition matches the ref prefix directly', () => {
  const defs = [{ prefix: 'chat-send-button', templated: false }];
  assert.equal(isLiveReference(defs, { prefix: 'chat-send-button', templated: false }), true);
});

test('isLiveReference is true when the ref rebuilds a shorter prefix than a templated definition', () => {
  const defs = [{ prefix: 'daemon-row-item-', templated: true }];
  const ref = { prefix: 'daemon-row-', templated: true };
  assert.equal(isLiveReference(defs, ref), true);
});

test('isLiveReference is false when no definition matches', () => {
  const defs = [{ prefix: 'other-thing', templated: false }];
  assert.equal(isLiveReference(defs, { prefix: 'ghost-button', templated: false }), false);
});

test('isLiveReference is true when the ref composes a known suffix onto a static definition', () => {
  const defs = [{ prefix: 'git-confirm-dialog', templated: false }];
  const ref = { prefix: 'git-confirm-dialog-confirm', templated: false };
  assert.equal(isLiveReference(defs, ref, ['-confirm']), true);
});

test('isLiveReference ignores an unknown suffix even when the remainder matches a definition', () => {
  const defs = [{ prefix: 'git-confirm-dialog', templated: false }];
  const ref = { prefix: 'git-confirm-dialog-confirm', templated: false };
  assert.equal(isLiveReference(defs, ref, ['-cancel']), false);
});

test('analyze marks a definition referenced via a broad (non-strict) token and unused when nothing matches', () => {
  const sourceFiles = [
    {
      path: '/repo/packages/ui/src/features/files/FilesRoot.tsx',
      text: 'const a = <button data-testid="files-root-toggle" />;\nconst b = <button data-testid="totally-unused-thing" />;',
    },
  ];
  const specFiles = [
    {
      path: '/repo/packages/e2e/helpers/zones.ts',
      text: "openZone(page, 'zone-rail-button-files', 'files-root-toggle');",
    },
  ];
  const report = analyze({ sourceFiles, specFiles });
  assert.ok(!report.unused.some((d) => d.prefix === 'files-root-toggle'));
  assert.ok(report.unused.some((d) => d.prefix === 'totally-unused-thing'));
  assert.equal(report.referencedCount, 1);
});

test('analyze counts a templated family referenced only via a backtick getByTestId call as live, not unused, not dead', () => {
  const sourceFiles = [
    {
      path: '/repo/packages/ui/src/features/session-tabs/SessionTabPill.tsx',
      text: 'function SessionTabPill({ id }) {\n  return <button data-testid={`session-tab-close-${id}`} />;\n}',
    },
  ];
  const specFiles = [
    {
      path: '/repo/packages/e2e/tests-tauri/session-tabs.spec.ts',
      text: 'await page.getByTestId(`session-tab-close-${id}`).click();',
    },
  ];
  const report = analyze({ sourceFiles, specFiles });
  assert.ok(!report.unused.some((d) => d.prefix === 'session-tab-close-' && d.templated === true));
  assert.equal(report.referencedCount, 1);
  assert.equal(report.dead.length, 0);
});

test('analyze reports a strict ref with no matching definition as dead, attributed to the referencing spec basename', () => {
  const sourceFiles = [
    {
      path: '/repo/packages/ui/src/features/chat/composer/SendButton.tsx',
      text: 'const el = <button data-testid="chat-send-button" />;',
    },
  ];
  const specFiles = [
    {
      path: '/repo/packages/e2e/tests-tauri/a.spec.ts',
      text: "await page.getByTestId('chat-send-button').click();",
    },
    {
      path: '/repo/packages/e2e/tests-tauri/b.spec.ts',
      text: "await page.getByTestId('ghost-button').click();",
    },
  ];
  const report = analyze({ sourceFiles, specFiles });
  const deadEntry = report.dead.find((d) => d.id === 'ghost-button');
  assert.ok(deadEntry, 'expected a dead entry for ghost-button');
  assert.deepEqual(deadEntry.specs, ['b.spec.ts']);
  const aSpec = report.perSpec.find((s) => s.spec === 'a.spec.ts');
  const bSpec = report.perSpec.find((s) => s.spec === 'b.spec.ts');
  assert.deepEqual(aSpec, { spec: 'a.spec.ts', live: 1, dead: 0 });
  assert.deepEqual(bSpec, { spec: 'b.spec.ts', live: 0, dead: 1 });
});

test('analyze dedupes an id defined in two source files into a single entry', () => {
  const sourceFiles = [
    { path: '/repo/packages/ui/src/features/a/A.tsx', text: 'const a = <button data-testid="dup-button" />;' },
    { path: '/repo/packages/ui/src/features/b/B.tsx', text: 'const b = <button data-testid="dup-button" />;' },
  ];
  const report = analyze({ sourceFiles, specFiles: [] });
  assert.deepEqual(report.definitions, [{ prefix: 'dup-button', templated: false }]);
  assert.equal(report.definedCount, 1);
});

test('analyze sorts definitions and unused bytewise, not with localeCompare', () => {
  const sourceFiles = [
    {
      path: '/repo/packages/ui/src/features/chat/Chat.tsx',
      text: 'const a = <button data-testid="chat-Zed" />;\nconst b = <button data-testid="chat-abc" />;',
    },
  ];
  const report = analyze({ sourceFiles, specFiles: [] });
  const expected = [
    { prefix: 'chat-Zed', templated: false },
    { prefix: 'chat-abc', templated: false },
  ];
  assert.deepEqual(report.definitions, expected);
  assert.deepEqual(report.unused, expected);
});

test('analyze does not exclude test-file paths itself', () => {
  const sourceFiles = [
    {
      path: '/repo/packages/ui/src/features/chat/__tests__/Fixture.test.tsx',
      text: 'const a = <button data-testid="test-only-fixture-id" />;',
    },
  ];
  const report = analyze({ sourceFiles, specFiles: [] });
  assert.ok(report.definitions.some((d) => d.prefix === 'test-only-fixture-id'));
});

test('analyze groups unused counts by surface, sorted by unused count descending then surface ascending', () => {
  const sourceFiles = [
    {
      path: '/repo/packages/ui/src/features/chat/Chat.tsx',
      text: 'const a = <button data-testid="chat-one" />;\nconst b = <button data-testid="chat-two" />;',
    },
    {
      path: '/repo/packages/ui/src/features/daemon/Daemon.tsx',
      text: 'const c = <button data-testid="daemon-one" />;',
    },
    {
      path: '/repo/packages/ui/src/features/chat/gates/Gate.tsx',
      text: 'const d = <button data-testid="gates-approve" />;',
    },
  ];
  const specFiles = [
    {
      path: '/repo/packages/e2e/tests-tauri/gates.spec.ts',
      text: "await page.getByTestId('gates-approve').click();",
    },
  ];
  const report = analyze({ sourceFiles, specFiles });
  assert.deepEqual(report.bySurface, [
    { surface: 'chat', defined: 2, unused: 2 },
    { surface: 'daemon', defined: 1, unused: 1 },
    { surface: 'gates', defined: 1, unused: 0 },
  ]);
});

test('analyze treats a strict ref into an itemTestIdPrefix family as live, not dead', () => {
  const sourceFiles = [
    {
      path: '/repo/packages/ui/src/features/chat/composer/triggers/ComposerTriggers.tsx',
      text: "const triggers = [{ itemTestIdPrefix: 'composer-file-item' }];",
    },
  ];
  const specFiles = [
    {
      path: '/repo/packages/e2e/tests-tauri/composer-advanced.spec.ts',
      text: "await page.getByTestId('composer-file-item-notes').click();",
    },
  ];
  const report = analyze({ sourceFiles, specFiles });
  assert.equal(report.dead.length, 0);
});

test('analyze treats a strict ref composing a harvested suffix onto a static definition as live, not dead', () => {
  const sourceFiles = [
    {
      path: '/repo/packages/ui/src/features/git/git-confirm.ts',
      text: "requestConfirm({ ...opts, testid: 'git-confirm-dialog' });",
    },
    {
      path: '/repo/packages/ui/src/features/shared/ConfirmDialog.tsx',
      text: 'const el = <button data-testid={`${testid}-confirm`} />;',
    },
  ];
  const specFiles = [
    {
      path: '/repo/packages/e2e/tests-tauri/git-branch.spec.ts',
      text: "await page.getByTestId('git-confirm-dialog-confirm').click();",
    },
  ];
  const report = analyze({ sourceFiles, specFiles });
  assert.equal(report.dead.length, 0);
  assert.ok(report.unused.some((d) => d.prefix === 'git-confirm-dialog'), 'suffix liveness stays out of unused');
});

test('analyze lists a spec with zero strict refs in perSpec, sorted by basename ascending', () => {
  const sourceFiles = [];
  const specFiles = [
    { path: '/repo/packages/e2e/tests-tauri/z.spec.ts', text: 'const n = 1;' },
    { path: '/repo/packages/e2e/tests-tauri/a.spec.ts', text: 'const n = 2;' },
  ];
  const report = analyze({ sourceFiles, specFiles });
  assert.deepEqual(report.perSpec, [
    { spec: 'a.spec.ts', live: 0, dead: 0 },
    { spec: 'z.spec.ts', live: 0, dead: 0 },
  ]);
});
