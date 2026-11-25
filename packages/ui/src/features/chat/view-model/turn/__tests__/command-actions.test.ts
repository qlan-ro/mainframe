import { expect, it } from 'vitest';
import { summarizeCommandActions } from '../command-actions';

it('summarizes a complete homogeneous read list', () => {
  expect(
    summarizeCommandActions([
      { type: 'read', command: 'cat src/a.ts', name: 'a.ts', path: 'src/a.ts' },
      { type: 'read', command: 'cat src/b.ts', name: 'b.ts', path: 'src/b.ts' },
    ]),
  ).toEqual({ kind: 'read', target: '2 files in src' });
});
it('keeps a structured search query and directory', () => {
  expect(summarizeCommandActions([{ type: 'search', command: 'rg needle src', query: 'needle', path: 'src' }])).toEqual(
    { kind: 'grep', target: 'for "needle" in src' },
  );
});
it('summarizes explicit listings', () => {
  expect(summarizeCommandActions([{ type: 'listFiles', command: 'ls src', path: 'src' }])).toEqual({
    kind: 'list',
    target: 'src',
  });
});
it.each(
  [
    null,
    {},
    'read',
    [],
    [{ type: 'unknown', command: 'cat a' }],
    [{ type: 'read', command: 'cat a', name: 'a', path: 1 }],
    [
      { type: 'read', command: 'cat a', name: 'a', path: 'a' },
      { type: 'unknown', command: 'echo b' },
    ],
    [
      { type: 'read', command: 'cat a', name: 'a', path: 'a' },
      { type: 'search', command: 'rg q', query: 'q', path: '.' },
    ],
    [
      { type: 'search', command: 'rg a', query: 'a' },
      { type: 'search', command: 'rg b', query: 'b' },
    ],
  ].map((value) => ({ value })),
)('rejects incomplete or mixed actions as a whole: %j', ({ value }) => {
  expect(summarizeCommandActions(value)).toBeUndefined();
});
