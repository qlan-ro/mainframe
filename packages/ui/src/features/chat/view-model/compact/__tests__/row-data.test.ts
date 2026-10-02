import { expect, it } from 'vitest';
import { buildCompactRows } from '../build-compact-rows';
import { indexed } from './fixtures';

const result = (added: number, removed: number) => ({
  content: 'done',
  structuredPatch: [
    {
      oldStart: 1,
      oldLines: removed,
      newStart: 1,
      newLines: added,
      lines: [...Array.from({ length: removed }, () => '-old'), ...Array.from({ length: added }, () => '+new')],
    },
  ],
});

it('sums +3/-1 and +5/-2 as operation totals even for one repeated file', () => {
  const rows = buildCompactRows(
    [indexed(0, { toolName: 'Edit', result: result(3, 1) }), indexed(1, { toolName: 'Edit', result: result(5, 2) })],
    new Set(),
  );
  expect(rows).toMatchObject([{ label: 'Edited src/file.ts (2 edits)', diff: { added: 8, removed: 3 } }]);
});
it('suppresses incomplete totals without losing the individual calls', () => {
  const rows = buildCompactRows(
    [indexed(0, { toolName: 'Edit', result: result(3, 1) }), indexed(1, { toolName: 'Edit', result: 'done' })],
    new Set(),
  );
  expect(rows).toMatchObject([{ indices: [0, 1], toolCallIds: ['call-0', 'call-1'] }]);
  expect(rows[0]).not.toHaveProperty('diff');
});
it('shares fallback edit counts and does not infer Write creation from prose', () => {
  const rows = buildCompactRows(
    [
      indexed(0, { toolName: 'Edit', args: { file_path: 'a', old_string: 'old\n', new_string: 'new\n' } }),
      indexed(1, { toolName: 'Write', args: { file_path: 'b', content: 'one\ntwo' }, result: 'created b' }),
    ],
    new Set(),
  );
  expect(rows[0]).toMatchObject({ diff: { added: 1, removed: 1 } });
  expect(rows[1]).toMatchObject({ label: 'Wrote b' });
  expect(rows[1]).not.toHaveProperty('diff');
});
it('retains known zero counts', () => {
  expect(
    buildCompactRows([indexed(0, { toolName: 'Write', result: { content: '', structuredPatch: [] } })], new Set())[0],
  ).toMatchObject({ diff: { added: 0, removed: 0 } });
});
it('preserves structurally valid supplied timing on a single call', () => {
  const timing = { startedAt: 1000, completedAt: 1500 };
  expect(buildCompactRows([indexed(0, { timing })], new Set())[0]).toMatchObject({ timing });
});
it.each([
  { startedAt: -1 },
  { startedAt: Infinity },
  { startedAt: '1000' },
  { startedAt: 2, completedAt: 1 },
  { startedAt: 1, completedAt: null },
  { startedAt: NaN },
])('omits malformed native timing: %j', (timing) => {
  expect(buildCompactRows([indexed(0, { timing: timing as never })], new Set())[0]).not.toHaveProperty('timing');
});
it('retains a terminal reported duration without inventing timestamps', () => {
  const row = buildCompactRows([indexed(0, { providerMetadata: { codex: { reportedDurationMs: 0 } } })], new Set())[0];
  expect(row).toMatchObject({ reportedDurationMs: 0 });
  expect(row).not.toHaveProperty('timing');
});
it.each([-1, NaN, Infinity, '10', null])('rejects an invalid reported duration: %j', (reportedDurationMs) => {
  const row = buildCompactRows(
    [indexed(0, { providerMetadata: { codex: { reportedDurationMs } } as never })],
    new Set(),
  )[0];
  expect(row).not.toHaveProperty('reportedDurationMs');
});
it('never attaches or sums durations for merged calls', () => {
  const rows = buildCompactRows(
    [0, 1].map((index) =>
      indexed(index, {
        timing: { startedAt: 1, completedAt: 50 },
        providerMetadata: { codex: { reportedDurationMs: 49 } },
      }),
    ),
    new Set(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).not.toHaveProperty('timing');
  expect(rows[0]).not.toHaveProperty('reportedDurationMs');
});
it('does not use a reported duration as an active clock', () => {
  const row = buildCompactRows(
    [
      indexed(0, {
        result: undefined,
        status: { type: 'running' },
        providerMetadata: { codex: { reportedDurationMs: 123 } },
      }),
    ],
    new Set(),
  )[0];
  expect(row).not.toHaveProperty('reportedDurationMs');
  expect(row).not.toHaveProperty('timing');
});
