import { expect, it } from 'vitest';
import { buildCompactRows } from '../build-compact-rows';
import { indexed, tool } from './fixtures';
import type { IndexedPart } from '../types';

it('merges adjacent successful reads while retaining original membership', () => {
  const parts = ['src/a.ts', 'src/b.ts', 'src/c.ts'].map((file_path, index) =>
    indexed(index + 4, { args: { file_path } }),
  );
  expect(buildCompactRows(parts, new Set())).toEqual([
    {
      type: 'tool',
      indices: [4, 5, 6],
      toolCallIds: ['call-4', 'call-5', 'call-6'],
      kind: 'read',
      status: 'success',
      label: 'Read 3 files in src',
    },
  ]);
});

it.each([
  ['Read', 'read'],
  ['Edit', 'edit'],
  ['Write', 'write'],
  ['Glob', 'glob'],
  ['Grep', 'grep'],
  ['LS', 'list'],
  ['WebSearch', 'web-search'],
  ['WebFetch', 'fetch'],
  ['Bash', 'shell'],
  ['Task', 'subagent'],
  ['mcp__server__tool', 'mcp'],
  ['ReadMore', 'unknown'],
  ['Agent', 'unknown'],
  ['Skill', 'unknown'],
  ['constructor', 'unknown'],
  ['toString', 'unknown'],
] as const)('uses the exact tool table for %s', (toolName, kind) => {
  expect(buildCompactRows([indexed(0, { toolName })], new Set())[0]).toMatchObject({ type: 'tool', kind });
});

it.each(['ExitPlanMode', 'AskUserQuestion', 'Workflow', 'RunWorkflow'])('keeps %s as a full card', (toolName) => {
  expect(buildCompactRows([indexed(3, { toolName })], new Set())).toEqual([{ type: 'passthrough', indices: [3] }]);
});

it.each([
  { type: 'text', text: 'Explanation', status: { type: 'complete' } },
  { type: 'reasoning', text: 'Thinking', status: { type: 'complete' } },
  { type: 'image', image: 'data:image/png;base64,a', status: { type: 'complete' } },
  tool({ toolName: 'ExitPlanMode', result: '' }),
  tool({ toolName: 'Edit', result: '' }),
  tool({ isError: true, result: 'error' }),
  tool({ result: undefined, status: { type: 'running' } }),
] as const)('ends read runs at %j', (part) => {
  const rows = buildCompactRows([indexed(0), { index: 1, part }, indexed(2)], new Set());
  expect(rows).toHaveLength(3);
  expect(rows.map((row) => row.indices)).toEqual([[0], [1], [2]]);
});

it('skips blank text without crossing meaningful content', () => {
  const blank: IndexedPart = { index: 8, part: { type: 'text', text: ' \n ', status: { type: 'complete' } } };
  expect(buildCompactRows([indexed(7), blank, indexed(9)], new Set())[0]).toMatchObject({
    indices: [7, 9],
    toolCallIds: ['call-7', 'call-9'],
    label: 'Read src/file.ts (2 reads)',
  });
});
