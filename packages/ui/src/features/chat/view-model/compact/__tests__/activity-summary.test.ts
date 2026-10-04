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
it('summarizes categories in fixed order, sorts integrations and deduplicates changed paths', () => {
  const members = [
    member('WebSearch'),
    member('Bash', { command: 'echo a' }),
    member('mcp__zeta__query'),
    member('Write', { file_path: 'src/a.ts' }),
    member('Edit', { file_path: 'src/a.ts' }),
    member('mcp__alpha__query'),
    member('mcp____query'),
    member('Read'),
    member('Bash', { command: 'custom task' }),
    member('mcp__alpha__list'),
  ];
  expect(activitySummary(members)).toBe(
    'Used alpha, used zeta, called a tool, edited a file, read files, ran commands, searched the web',
  );
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
  expect(activitySummary([command, member('Bash', { command: 'rg --files src' })])).toBe('Read files');
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
