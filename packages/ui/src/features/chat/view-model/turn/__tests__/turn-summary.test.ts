import { expect, it } from 'vitest';
import { exploreSummary, turnSummary } from '../turn-summary';
import { bash, call } from './fixtures';

it('counts a file once however often it was touched', () => {
  const edit = (file: string) => call('Edit', { file_path: file });
  expect(turnSummary([edit('a'), edit('a'), edit('b'), bash('x'), bash('x'), bash('y')])).toBe(
    'edited 2 files, ran 3 commands',
  );
});

it('uses the singular', () => {
  expect(turnSummary([call('Read', { file_path: 'a' }), call('Grep', { pattern: 'x' })])).toBe(
    'read 1 file, searched 1 pattern',
  );
});

it('folds a long tail', () => {
  const parts = [
    call('WebFetch', { url: 'a' }),
    call('mcp__github__get_issue', {}),
    call('Read', { file_path: 'a' }),
    bash('x'),
    call('Edit', { file_path: 'b' }),
  ];
  expect(turnSummary(parts)).toBe('edited 1 file, read 1 file, ran 1 command, 2 more');
});

it('leaves agents, tasks and workflows to the header', () => {
  expect(turnSummary([call('Task', {}), call('mcp__mainframe__delegate_task', {}), call('Workflow', {})])).toBe('');
});

it('counts the images an agent made', () => {
  expect(turnSummary([bash('x')], 2)).toBe('ran 1 command, generated 2 images');
  expect(turnSummary([], 1)).toBe('generated 1 image');
});

it('sums up a run of reads and searches', () => {
  expect(exploreSummary([call('Read', {}), call('Read', {}), call('Grep', {}), call('Glob', {})])).toBe(
    '2 files, 2 searches',
  );
  expect(exploreSummary([call('Read', {})])).toBe('1 file');
});
