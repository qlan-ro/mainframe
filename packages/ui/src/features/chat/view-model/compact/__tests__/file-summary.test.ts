import { expect, it } from 'vitest';
import { summarizeFiles, sumDiffStats } from '../file-summary';

it.each([
  [['src/a.ts'], 'src/a.ts'],
  [['src/a.ts', 'src/b.ts', 'src/c.ts'], '3 files in src'],
  [['src/a.ts', 'src/a.ts'], 'src/a.ts (2 edits)'],
  [['src/a.ts', 'src/b.ts', 'src/a.ts'], '2 files in src'],
  [['src/a.ts', 'test/b.ts'], '2 files'],
  [['/a.ts', '/b.ts'], '2 files'],
  [['C:\\a.ts', 'C:\\b.ts'], '2 files'],
  [['C:\\src\\a.ts', 'C:/src/b.ts'], '2 files in C:/src'],
  [['C:/src/a.ts', 'D:/src/b.ts'], '2 files'],
  [['src\\a.ts', 'src/a.ts'], 'src/a.ts (2 edits)'],
  [['//host/share/a.ts', '//host/share/b.ts'], '2 files'],
  [['src/a.ts', null], undefined],
  [[undefined], undefined],
  [[''], undefined],
  [[], undefined],
] as const)('summarizes known paths %j', (paths, expected) => {
  expect(summarizeFiles(paths, 'edit')).toBe(expected);
});

it('sums operation counts including repeated edits', () => {
  expect(
    sumDiffStats([
      { added: 3, removed: 1 },
      { added: 5, removed: 2 },
    ]),
  ).toEqual({ added: 8, removed: 3 });
});
it.each([{ stats: [] }, { stats: [{ added: 3, removed: 1 }, null] }, { stats: [undefined] }])(
  'omits incomplete totals: %j',
  ({ stats }) => {
    expect(sumDiffStats(stats)).toBeUndefined();
  },
);
it('keeps a known zero total', () => {
  expect(sumDiffStats([{ added: 0, removed: 0 }])).toEqual({ added: 0, removed: 0 });
});

it('does not resolve relative segments or collapse distinct filename whitespace', () => {
  expect(summarizeFiles(['src/a  b.ts', 'src/a b.ts'], 'read')).toBe('2 files in src');
  expect(summarizeFiles(['src/../a.ts', 'a.ts'], 'read')).toBe('2 files');
});
