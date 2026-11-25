import { expect, it } from 'vitest';
import { summarizeFiles } from '../file-summary';

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

it('does not resolve relative segments or collapse distinct filename whitespace', () => {
  expect(summarizeFiles(['src/a  b.ts', 'src/a b.ts'], 'read')).toBe('2 files in src');
  expect(summarizeFiles(['src/../a.ts', 'a.ts'], 'read')).toBe('2 files');
});
