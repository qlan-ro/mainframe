import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectDefinitions, collectReferences, stringLiterals } from '../extract.mjs';

test('collectDefinitions finds a static data-testid attribute', () => {
  const src = 'const el = <button data-testid="chat-send-button" />;';
  assert.deepEqual(collectDefinitions(src), [{ prefix: 'chat-send-button', templated: false }]);
});

test('collectDefinitions finds a templated data-testid attribute', () => {
  const lines = ['function Row({ d }) {', '  return <div data-testid={`daemon-row-${d.id}`} />;', '}'];
  const src = lines.join('\n');
  assert.deepEqual(collectDefinitions(src), [{ prefix: 'daemon-row-', templated: true }]);
});

test('collectDefinitions finds testId and testIdPrefix prop literals', () => {
  const lines = ['<Toggle testId="settings-toggle-foo" />;', '<Field testIdPrefix="tasks-field" />;'];
  const src = lines.join('\n');
  assert.deepEqual(collectDefinitions(src), [
    { prefix: 'settings-toggle-foo', templated: false },
    { prefix: 'tasks-field', templated: false },
  ]);
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
    { prefix: 'tasks-field', templated: false },
    { prefix: 'chat-send-button', templated: false },
  ]);
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
