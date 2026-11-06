import { expect, it } from 'vitest';
import { activitySummary } from '../activity-summary';
import { activityLabel } from '../activity-label';
import type { ActivityMember, CompactToolPart } from '../types';
import { tool } from './fixtures';

function member(
  name: string,
  args: CompactToolPart['args'] = {},
  overrides: Partial<CompactToolPart> = {},
): ActivityMember {
  return {
    messageId: 'm',
    rootThreadId: 'root',
    ancestors: [],
    index: 0,
    part: tool({ toolName: name, args, result: '', ...overrides }),
  };
}
it('counts distinct targets per category in fixed order and sorts integrations first', () => {
  const members = [
    member('mcp__zeta__query'),
    member('Write', { file_path: 'src/a.ts' }),
    member('Edit', { file_path: 'src/a.ts' }),
    member('Edit', { file_path: 'src/b.ts' }),
    member('Bash', { command: 'echo a' }),
    member('Bash', { command: 'custom task' }),
  ];
  expect(activitySummary(members)).toBe('Used zeta, edited 2 files, ran 2 commands');
  expect(activitySummary([member('Read', { file_path: 'a.ts' }), member('Read', { file_path: 'a.ts' })])).toBe(
    'Read a file',
  );
});
it('folds the tail into a remaining-count phrase past four categories', () => {
  const members = [
    member('WebSearch'),
    member('mcp__alpha__query'),
    member('mcp____query'),
    member('Edit', { file_path: 'src/a.ts' }),
    member('Read', { file_path: 'src/b.ts' }),
    member('Bash', { command: 'echo a' }),
  ];
  expect(activitySummary(members)).toBe('Used alpha, called a tool, edited a file, and 3 more');
});
it('suffixes failed calls on the category they belong to', () => {
  const failed = member('Bash', { command: 'npm test' }, { isError: true, toolCallId: 'failed' });
  expect(activitySummary([member('Bash', { command: 'echo a' }), failed, member('Read', { file_path: 'a.ts' })])).toBe(
    'Read a file, ran 2 commands (1 failed)',
  );
});
it('rolls unrecognised tools into the generic tool count', () => {
  expect(activitySummary([member('TodoWrite'), member('Skill', {}, { toolCallId: 'skill' })])).toBe('Called 2 tools');
});
it('reuses structured exploration semantics before conservative command parsing', () => {
  const command = member(
    'Bash',
    { command: 'custom reader' },
    {
      providerMetadata: {
        codex: { commandActions: [{ type: 'read', command: 'custom reader', path: 'src/a.ts', name: 'a.ts' }] },
      },
    },
  );
  expect(activitySummary([command, member('Bash', { command: 'rg --files src' })])).toBe('Read a file, listed files');
  expect(activitySummary([member('Bash', { command: 'cat a.ts && npm test' })])).toBe('Ran a command');
  expect(activitySummary([member('Bash', { command: 'unknown', description: 'read all files' })])).toBe(
    'Ran a command',
  );
});
it('never classifies from output and handles empty and reasoning-only work without duration', () => {
  const command = member('Bash', { command: 'unknown' }, { result: 'Read 100 files and searched the web' });
  expect(activitySummary([command])).toBe('Ran a command');
  expect(activitySummary([])).toBe('Worked');
  expect(
    activitySummary([{ ...command, part: { type: 'reasoning', text: 'Consider', status: { type: 'complete' } } }]),
  ).toBe('Thought');
});
it('chooses the latest running command over an earlier search', () => {
  const read = member('Bash', { command: 'rg --files src' }, { status: { type: 'running' } });
  const shell = member('Bash', { command: 'pnpm test' }, { toolCallId: 'later', status: { type: 'running' } });
  expect(activityLabel({ type: 'activity', members: [read, shell], active: true }, new Set()).text).toBe(
    'Running tests',
  );
});
