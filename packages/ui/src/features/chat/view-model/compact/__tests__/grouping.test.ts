import { expect, it } from 'vitest';
import { buildCompactRows } from '../build-compact-rows';
import { indexed } from './fixtures';
import type { CompactToolPart, IndexedPart } from '../types';

it.each(['Bash', 'mcp__server__read', 'Task', 'Unknown', 'Skill'])('never merges %s calls', (toolName) => {
  expect(buildCompactRows([indexed(0, { toolName }), indexed(1, { toolName })], new Set())).toHaveLength(2);
});
it.each(['running', 'failed', 'cancelled', 'missing', 'denied', 'pending'])('never merges %s calls', (state) => {
  const overrides: Partial<CompactToolPart> =
    state === 'denied'
      ? { approval: { id: 'a', approved: false } }
      : state === 'missing'
        ? { result: undefined }
        : { providerMetadata: { mainframe: { acpStatus: state === 'running' ? 'in_progress' : state } } };
  expect(buildCompactRows([indexed(0, overrides), indexed(1, overrides)], new Set())).toHaveLength(2);
});
it('uses permission IDs to split an otherwise successful read run', () => {
  const rows = buildCompactRows([indexed(0), indexed(1), indexed(2)], new Set(['call-1']));
  expect(rows).toHaveLength(3);
  expect(rows[1]).toMatchObject({ status: 'awaiting-approval', label: 'Waiting for approval: read src/file.ts' });
});
it.each([{}, { file_path: '' }, { file_path: 42 }, null, []])('keeps calls with missing paths separate: %j', (args) => {
  const rows = buildCompactRows([indexed(0, { args: args as never }), indexed(1)], new Set());
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ label: 'Read' });
});
it.each([
  ['Glob', { pattern: '*.ts', path: 'src' }, 'Found files matching "*.ts" in src (2 searches)'],
  ['Grep', { pattern: 'needle', path: 'src' }, 'Searched for "needle" in src (2 searches)'],
  ['LS', { path: 'src' }, 'Listed src (2 listings)'],
  ['WebSearch', { query: 'assistant ui' }, 'Searched the web for "assistant ui" (2 searches)'],
  ['WebFetch', { url: 'https://example.com' }, 'Fetched https://example.com (2 fetches)'],
] as const)('merges meaningful %s calls', (toolName, args, label) => {
  expect(buildCompactRows([indexed(0, { toolName, args }), indexed(1, { toolName, args })], new Set())).toMatchObject([
    { indices: [0, 1], label },
  ]);
});
it('keeps distinct search patterns separate rather than losing the operation detail', () => {
  const rows = buildCompactRows(
    [
      indexed(0, { toolName: 'Grep', args: { pattern: 'a' } }),
      indexed(1, { toolName: 'Grep', args: { pattern: 'b' } }),
    ],
    new Set(),
  );
  expect(rows).toHaveLength(2);
});
it('retains membership after an active call settles and joins its neighbor', () => {
  const active = indexed(9, { result: 'partial', providerMetadata: { mainframe: { acpStatus: 'in_progress' } } });
  const first = indexed(3);
  const before = buildCompactRows([first, active], new Set());
  const after = buildCompactRows(
    [
      first,
      {
        ...active,
        part: { ...active.part, providerMetadata: { mainframe: { acpStatus: 'completed' } } },
      } as IndexedPart,
    ],
    new Set(),
  );
  expect(before.map((row) => row.indices)).toEqual([[3], [9]]);
  expect(after).toMatchObject([{ indices: [3, 9], toolCallIds: ['call-3', 'call-9'] }]);
  expect(buildCompactRows([first], new Set())).toMatchObject([{ indices: [3] }]);
});
it('combines adjacent reasoning parts without merging tools across them', () => {
  const rows = buildCompactRows(
    [
      indexed(0),
      { index: 1, part: { type: 'reasoning', text: 'a', status: { type: 'complete' } } },
      { index: 2, part: { type: 'reasoning', text: 'b', status: { type: 'running' } } },
      indexed(3),
    ],
    new Set(),
  );
  expect(rows).toHaveLength(3);
  expect(rows[1]).toEqual({ type: 'reasoning', indices: [1, 2], running: true, label: 'Thinking' });
});
