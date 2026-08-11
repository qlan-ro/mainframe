import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectDefinitions, collectReferences, collectTestIdSuffixes, stringLiterals } from '../extract.mjs';

test('collectDefinitions finds a static data-testid attribute', () => {
  const src = 'const el = <button data-testid="chat-send-button" />;';
  assert.deepEqual(collectDefinitions(src), [{ prefix: 'chat-send-button', templated: false }]);
});

test('collectDefinitions finds a templated data-testid attribute', () => {
  const lines = ['function Row({ d }) {', '  return <div data-testid={`daemon-row-${d.id}`} />;', '}'];
  const src = lines.join('\n');
  assert.deepEqual(collectDefinitions(src), [{ prefix: 'daemon-row-', templated: true }]);
});

test('collectDefinitions finds a testId prop literal', () => {
  const src = '<Toggle testId="settings-toggle-foo" />;';
  assert.deepEqual(collectDefinitions(src), [{ prefix: 'settings-toggle-foo', templated: false }]);
});

test('collectDefinitions marks a *Prefix token as templated even without a ${ in its literal', () => {
  const src = '<Field testIdPrefix="tasks-field" />;';
  assert.deepEqual(collectDefinitions(src), [{ prefix: 'tasks-field', templated: true }]);
});

test('collectDefinitions marks an itemTestIdPrefix literal as templated', () => {
  const src = "const triggers = [{ itemTestIdPrefix: 'composer-file-item' }];";
  assert.deepEqual(collectDefinitions(src), [{ prefix: 'composer-file-item', templated: true }]);
});

test('collectDefinitions treats a backtick value with no ${ as a static definition', () => {
  const src = 'const el = <button data-testid={`chat-send-button`} />;';
  assert.deepEqual(collectDefinitions(src), [{ prefix: 'chat-send-button', templated: false }]);
});

test('collectDefinitions ignores a bare data-testid passthrough', () => {
  const src = 'const el = <Passthrough data-testid={testId} />;';
  assert.deepEqual(collectDefinitions(src), []);
});

test('collectDefinitions discards a templated id with an empty prefix', () => {
  const lines = ['function Unlink({ surface, n }) {', '  return <button data-testid={`${PREFIX[surface]}-unlink-${n}`} />;', '}'];
  const src = lines.join('\n');
  assert.deepEqual(collectDefinitions(src), []);
});

test('collectDefinitions returns entries in order of appearance and may repeat', () => {
  const lines = [
    'const a = <button data-testid="chat-send-button" />;',
    'function Row({ d }) {',
    '  return <div data-testid={`daemon-row-${d.id}`} />;',
    '}',
    '<Toggle testId="settings-toggle-foo" />;',
    '<Field testIdPrefix="tasks-field" />;',
    'const b = <Passthrough data-testid={testId} />;',
    'const c = <button data-testid={`${PREFIX[surface]}-unlink-${n}`} />;',
    'const d2 = <button data-testid="chat-send-button" />;',
  ];
  const src = lines.join('\n');
  assert.deepEqual(collectDefinitions(src), [
    { prefix: 'chat-send-button', templated: false },
    { prefix: 'daemon-row-', templated: true },
    { prefix: 'settings-toggle-foo', templated: false },
    { prefix: 'tasks-field', templated: true },
    { prefix: 'chat-send-button', templated: false },
  ]);
});

test('collectDefinitions finds a testid object key in a menu descriptor', () => {
  const lines = ['const items = [', "  { label: 'Checkout', testid: 'git-submenu-checkout' },", '];'];
  assert.deepEqual(collectDefinitions(lines.join('\n')), [{ prefix: 'git-submenu-checkout', templated: false }]);
});

test('collectDefinitions finds both arms of a ternary data-testid', () => {
  const src = "<div data-testid={loading ? 'search-palette-loading' : 'search-palette-empty'} />;";
  assert.deepEqual(collectDefinitions(src), [
    { prefix: 'search-palette-loading', templated: false },
    { prefix: 'search-palette-empty', templated: false },
  ]);
});

test('collectDefinitions skips a non-id operand inside a braced expression', () => {
  const src = "<div data-testid={mode === 'compact' ? 'sessions-row-compact' : undefined} />;";
  assert.deepEqual(collectDefinitions(src), [{ prefix: 'sessions-row-compact', templated: false }]);
});

test('collectDefinitions finds a triggerId prop', () => {
  const src = '<CollapsibleCardShell testId="chat-write-card" triggerId="chat-write-trigger" />;';
  assert.deepEqual(collectDefinitions(src), [
    { prefix: 'chat-write-card', templated: false },
    { prefix: 'chat-write-trigger', templated: false },
  ]);
});

test('collectDefinitions keeps a templated id whose prefix ends in an uppercase letter', () => {
  const src = 'const el = <div data-testid={`chat-user-review-comment-L${item.start}`} />;';
  assert.deepEqual(collectDefinitions(src), [{ prefix: 'chat-user-review-comment-L', templated: true }]);
});

test('collectDefinitions ignores a data-testid written inside a comment', () => {
  const lines = ['// renders data-testid="chat-doc-only-id" on the root', '<div data-testid="chat-real-id" />;'];
  assert.deepEqual(collectDefinitions(lines.join('\n')), [{ prefix: 'chat-real-id', templated: false }]);
});

test('collectDefinitions finds a lowercase testid JSX prop', () => {
  const src = '<PickerRow testid="workspace-picker-open-file" icon={icon} label="Open file…" />;';
  assert.deepEqual(collectDefinitions(src), [{ prefix: 'workspace-picker-open-file', templated: false }]);
});

test('collectDefinitions finds a testId default-parameter assignment', () => {
  const lines = ['function ConnectionOverlay({', "  testId = 'connection-overlay',", '  children,', '}) {'];
  assert.deepEqual(collectDefinitions(lines.join('\n')), [{ prefix: 'connection-overlay', templated: false }]);
});

test('collectDefinitions finds a camelCase testId object-literal property', () => {
  const lines = ['const rows = [', "  { label: 'Version', testId: 'settings-about-version' },", '];'];
  assert.deepEqual(collectDefinitions(lines.join('\n')), [{ prefix: 'settings-about-version', templated: false }]);
});

test('collectDefinitions finds an itemTestIdPrefix object-literal property and marks it templated', () => {
  const src = "const config = { itemTestIdPrefix: 'automations-skill-item' };";
  assert.deepEqual(collectDefinitions(src), [{ prefix: 'automations-skill-item', templated: true }]);
});

test('collectReferences survives an apostrophe in a block comment', () => {
  const lines = [
    '/**',
    " * so the modal menu's pointer-events never leak into the next test.",
    ' */',
    "await page.getByTestId('tasks-board-new').click();",
  ];
  const refs = collectReferences(lines.join('\n'));
  assert.ok(refs.broad.includes('tasks-board-new'));
  assert.ok(refs.strict.some((d) => d.prefix === 'tasks-board-new'));
});

test('collectReferences survives an apostrophe inside a double-quoted string', () => {
  const lines = ['const label = "the card\'s title";', "await page.getByTestId('sessions-meta-card').click();"];
  assert.ok(collectReferences(lines.join('\n')).broad.includes('sessions-meta-card'));
});

test('collectReferences reads the id nested inside an attribute-selector literal', () => {
  const src = "await page.locator('[data-testid=\"zone-tab-files\"]').click();";
  assert.ok(collectReferences(src).broad.includes('zone-tab-files'));
});

test('collectReferences ignores a locator written inside a trailing line comment', () => {
  const src = "await click(page); // was getByTestId('sessions-legacy-row')";
  const refs = collectReferences(src);
  assert.ok(!refs.broad.includes('sessions-legacy-row'));
  assert.ok(!refs.strict.some((d) => d.prefix === 'sessions-legacy-row'));
});

test('collectReferences puts a bare helper argument in broad but not strict', () => {
  const src = "openZone(page, 'zone-rail-button-files', 'files-root-toggle');";
  const refs = collectReferences(src);
  assert.ok(refs.broad.includes('files-root-toggle'));
  assert.ok(!refs.strict.some((d) => d.prefix === 'files-root-toggle'));
});

test('collectReferences puts a static getByTestId call in both broad and strict', () => {
  const src = "await page.getByTestId('chat-send-button').click();";
  const refs = collectReferences(src);
  assert.ok(refs.broad.includes('chat-send-button'));
  assert.ok(refs.strict.some((d) => d.prefix === 'chat-send-button' && d.templated === false));
});

test('collectReferences puts a templated getByTestId call in strict as a templated definition', () => {
  const lines = ['await page.getByTestId(`daemon-row-${id}`).click();'];
  const src = lines.join('\n');
  const refs = collectReferences(src);
  assert.ok(refs.strict.some((d) => d.prefix === 'daemon-row-' && d.templated === true));
});

test('collectReferences puts a data-testid attribute selector in strict', () => {
  const src = 'await expect(page.locator(\'[data-testid="zone-tab-files"]\')).toBeVisible();';
  const refs = collectReferences(src);
  assert.ok(refs.strict.some((d) => d.prefix === 'zone-tab-files' && d.templated === false));
});

test('collectReferences drops a fully-interpolated attribute-selector value instead of keeping the raw ${…} text', () => {
  const src = 'const sel = `[data-testid="${T.sessionRow}"]`;';
  const refs = collectReferences(src);
  assert.ok(!refs.strict.some((d) => d.prefix.includes('${')));
});

test('collectReferences routes an attribute-selector value with a real prefix through toDefinition', () => {
  const src = 'const sel = `[data-testid="daemon-row-${id}"]`;';
  const refs = collectReferences(src);
  assert.ok(refs.strict.some((d) => d.prefix === 'daemon-row-' && d.templated === true));
});

test('collectReferences drops an attribute-selector value where the template variable precedes a suffix', () => {
  const src = 'const sel = `[data-testid="${x}-row"]`;';
  const refs = collectReferences(src);
  assert.ok(!refs.strict.some((d) => d.prefix.includes('${')));
});

test('collectReferences drops tokens shorter than 4 characters from broad', () => {
  const src = "const short = 'ok';";
  const refs = collectReferences(src);
  assert.ok(!refs.broad.includes('ok'));
});

test('stringLiterals collects single-, double- and backtick-quoted string contents', () => {
  const src = "const a = 'single-quote'; const b = \"double-quote\"; const c = `back-tick`;";
  const literals = stringLiterals(src);
  assert.ok(literals.includes('single-quote'));
  assert.ok(literals.includes('double-quote'));
  assert.ok(literals.includes('back-tick'));
});

test('stringLiterals reduces a backtick literal to the text before the first ${', () => {
  const lines = ['const id = `daemon-row-${d.id}`;'];
  const src = lines.join('\n');
  const literals = stringLiterals(src);
  assert.ok(literals.includes('daemon-row-'));
  assert.ok(!literals.some((l) => l.includes('${')));
});

test('collectTestIdSuffixes harvests the static suffix from a single-interpolation data-testid template', () => {
  const src = 'const el = <button data-testid={`${testid}-confirm`} />;';
  assert.deepEqual(collectTestIdSuffixes(src), ['-confirm']);
});

test('collectTestIdSuffixes ignores a template with a second interpolation after the suffix', () => {
  const src = 'const el = <button data-testid={`${a}-${b}`} />;';
  assert.deepEqual(collectTestIdSuffixes(src), []);
});

test('collectTestIdSuffixes ignores a backtick template that is not a data-testid attribute', () => {
  const src = 'const label = `${testid}-confirm`;';
  assert.deepEqual(collectTestIdSuffixes(src), []);
});

test('collectTestIdSuffixes dedupes repeated suffixes across a file', () => {
  const lines = [
    'const a = <button data-testid={`${testId}-menu`} />;',
    'const b = <button data-testid={`${testId}-menu`} />;',
  ];
  assert.deepEqual(collectTestIdSuffixes(lines.join('\n')), ['-menu']);
});
