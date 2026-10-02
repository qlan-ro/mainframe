import { describe, expect, it } from 'vitest';
import { resolveToolDiff } from '../diff-data';

const patch = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 3, lines: ['-before', '+one', '+two', '+three'] }];

it.each(['Edit', 'Write'] as const)('counts structured %s hunks ahead of input strings', (kind) => {
  expect(
    resolveToolDiff(
      kind,
      { old_string: 'a', new_string: 'b', content: 'new file' },
      {
        content: 'done',
        structuredPatch: patch,
        originalFile: 'before\n',
        modifiedFile: 'one\ntwo\nthree\n',
      },
    ),
  ).toEqual({ hunks: patch, stats: { added: 3, removed: 1 } });
});

describe('Edit fallback', () => {
  it.each([
    ['old\n', 'new\nextra\n', 2, 1],
    ['', 'new\n', 1, 0],
    ['old\n', '', 0, 1],
    ['same\n', 'same\n', 0, 0],
  ])('counts the edit from %j to %j', (old_string, new_string, added, removed) => {
    expect(resolveToolDiff('Edit', { old_string, new_string }, 'done').stats).toEqual({ added, removed });
  });

  it('keeps two empty strings unavailable, as in the existing Edit card', () => {
    expect(resolveToolDiff('Edit', { old_string: '', new_string: '' }, 'done')).toEqual({ hunks: null, stats: null });
  });
});

it.each(['Edit', 'Write'] as const)('retains a known empty structured %s patch', (kind) => {
  expect(resolveToolDiff(kind, { old_string: 'old', new_string: 'new' }, { structuredPatch: [] })).toEqual({
    hunks: [],
    stats: { added: 0, removed: 0 },
  });
});

it('does not infer net additions from Write content', () => {
  expect(resolveToolDiff('Write', { content: 'one\ntwo\n' }, 'created successfully')).toEqual({
    hunks: null,
    stats: null,
  });
});

it.each([
  null,
  undefined,
  [],
  'invalid',
  {},
  { old_string: 'old' },
  { new_string: 'new' },
  { old_string: 42, new_string: 'new' },
  { old_string: 'old', new_string: null },
])('does not invent fallback counts from malformed or missing args: %j', (args) => {
  expect(resolveToolDiff('Edit', args, undefined)).toEqual({ hunks: null, stats: null });
});

it.each([
  null,
  {},
  'invalid',
  [null],
  [{ ...patch[0], lines: [42] }],
  [{ ...patch[0], lines: ['not a diff line'] }],
  [{ ...patch[0], oldStart: -1 }],
  [{ ...patch[0], newLines: Number.NaN }],
  [{ ...patch[0], oldLines: 0.5 }],
])('keeps malformed hunks unavailable: %j', (structuredPatch) => {
  for (const kind of ['Edit', 'Write'] as const) {
    expect(resolveToolDiff(kind, {}, { structuredPatch })).toEqual({ hunks: null, stats: null });
  }
});

it('can use valid edit input after an unusable patch', () => {
  expect(
    resolveToolDiff('Edit', { old_string: 'old\n', new_string: 'new\n' }, { structuredPatch: [{}] }).stats,
  ).toEqual({ added: 1, removed: 1 });
});

it('does not count context or newline markers', () => {
  expect(
    resolveToolDiff(
      'Write',
      {},
      {
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 2,
            lines: [' context', '+added', '\\ No newline at end of file'],
          },
        ],
      },
    ).stats,
  ).toEqual({ added: 1, removed: 0 });
});
