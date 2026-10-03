import { expect, it } from 'vitest';
import type { TranscriptPresentation } from '@qlan-ro/mainframe-types';
import { buildActivityGroups, activityMemberIdentity } from '../build-activity-groups';
import { activityLabel } from '../activity-label';
import type { ActivityGroup, ActivityMember } from '../types';
import { tool } from './fixtures';

const pending = new Set<string>();
const turn: TranscriptPresentation = {
  version: 1,
  provider: 'codex',
  turnId: 'turn',
  phase: 'work',
  state: 'running',
  finalEligible: false,
};
function member(index: number, toolName = 'Read', overrides: Partial<ActivityMember> = {}): ActivityMember {
  return {
    index,
    messageId: 'message',
    rootThreadId: 'root',
    ancestors: [],
    part: tool({ toolCallId: `call-${index}`, toolName, result: '', args: { file_path: `/src/${index}.ts` } }),
    ...overrides,
  };
}
const reasoning = (index: number): ActivityMember =>
  member(index, '', { part: { type: 'reasoning', text: 'Consider', status: { type: 'complete' } } });
const active = (index: number, toolName = 'Read') =>
  member(index, toolName, {
    part: tool({
      toolCallId: `call-${index}`,
      toolName,
      status: { type: 'running' },
      args: { file_path: `/src/${index}.ts`, command: 'npm test' },
    }),
  });
const groups = (members: ActivityMember[]) => buildActivityGroups(members, pending);

it('keeps mixed routine kinds and interleaved reasoning together without dropping native references', () => {
  const members = [
    member(0),
    reasoning(1),
    member(2, 'Edit'),
    member(3, 'Bash'),
    member(4, 'mcp__git__query'),
    member(5, 'WebSearch'),
  ];
  expect(groups(members)).toEqual([{ type: 'activity', members, active: false }]);
});
it.each(['ExitPlanMode', 'AskUserQuestion', 'Workflow', 'RunWorkflow', 'Task', 'UnknownDynamic'])(
  'keeps %s standalone and closes the preceding group',
  (name) => {
    const entries = groups([active(0), member(1, name), active(2)]);
    expect(entries.map((entry) => entry.type)).toEqual(['activity', 'standalone', 'activity']);
    expect(entries[0]).toMatchObject({ active: false });
    expect(entries[2]).toMatchObject({ active: true });
  },
);
it.each(['failed', 'cancelled', 'pending-approval', 'declined', 'unknown'])(
  'keeps %s tools outside routine groups',
  (status) => {
    const part = tool({
      result: status === 'unknown' ? undefined : '',
      providerMetadata: { mainframe: { acpStatus: status } },
      ...(status === 'declined' ? { approval: { id: 'approval', approved: false } } : {}),
    });
    const blocked = member(1, '', { part });
    const entries = buildActivityGroups(
      [member(0), blocked, member(2)],
      status === 'pending-approval' ? new Set(['call']) : pending,
    );
    expect(entries.map((entry) => entry.type)).toEqual(['activity', 'standalone', 'activity']);
  },
);
it('closes active labels at commentary, image, error and explicit phase boundaries', () => {
  for (const boundary of [
    member(1, '', { part: { type: 'text', text: 'Next step', status: { type: 'complete' } } }),
    member(1, '', { part: { type: 'image', image: 'data:image/png,a', status: { type: 'complete' } } }),
    member(1, 'Read', { boundary: true }),
    member(1, 'Read', { presentation: { ...turn, phase: 'commentary' } }),
  ])
    expect(groups([active(0), boundary])[0]).toMatchObject({ type: 'activity', active: false });
});
it('only spans messages with exact authoritative turn, provider and ancestry identities', () => {
  const a = member(0, 'Read', { presentation: turn, sourceMessageId: 'source-a' });
  const b = member(2, 'Edit', { messageId: 'next', presentation: { ...turn }, sourceMessageId: 'source-b' });
  expect(groups([a, b])).toHaveLength(1);
  for (const change of [
    { presentation: undefined },
    { presentation: { ...turn, turnId: 'other' } },
    { presentation: { ...turn, provider: 'claude' } },
    { presentation: { ...turn, parentToolUseId: 'child' } },
    { ancestors: ['child'] },
    { rootThreadId: 'side' },
  ])
    expect(groups([a, { ...b, ...change }])).toHaveLength(2);
  expect(groups([member(0), member(1, 'Read', { messageId: 'other' })])).toHaveLength(2);
});
it('preserves singleton identity while it completes, changes kind or gains neighbors', () => {
  const first = active(0);
  const before = activityMemberIdentity(first);
  expect(activityMemberIdentity(member(0, 'Edit'))).toBe(before);
  const grown = groups([member(0, 'Edit'), member(1)]);
  expect(activityMemberIdentity((grown[0] as ActivityGroup).members[0]!)).toBe(before);
  expect(activityMemberIdentity({ ...first, rootThreadId: 'side' })).not.toBe(before);
});
it('prefers running exploration then latest running and retains exploration while authoritative work is open', () => {
  const read = active(0);
  const shell = active(1, 'Bash');
  const group = groups([read, shell])[0] as ActivityGroup;
  expect(activityLabel(group, pending).text).toBe('Reading /src/0.ts');
  expect(activityLabel(groups([member(0), shell])[0] as ActivityGroup, pending).text).toBe('Running tests');
  const open = groups([member(0, 'Read', { presentation: turn })])[0] as ActivityGroup;
  expect(open.active).toBe(true);
  expect(activityLabel(open, pending).text).toBe('Reading /src/0.ts');
  expect(groups([member(0)])[0]).toMatchObject({ active: false });
  expect(buildActivityGroups([active(0)], pending, false)[0]).toMatchObject({ active: false });
});
it('uses only explicit local activity when metadata is absent and keeps reasoning in the active group', () => {
  const thought = {
    ...reasoning(1),
    part: { type: 'reasoning' as const, text: 'Working', status: { type: 'running' as const } },
  };
  expect(groups([member(0), thought])[0]).toMatchObject({ active: true });
  expect(activityLabel(groups([thought])[0] as ActivityGroup, pending).text).toBe('Thinking');
  expect(
    groups([
      active(0, 'Bash'),
      {
        ...active(2, 'Bash'),
        part: tool({
          toolCallId: 'last',
          toolName: 'Bash',
          args: { command: 'pnpm build' },
          status: { type: 'running' },
        }),
      },
    ])[0],
  ).toMatchObject({ active: true });
});

it('keeps invalidated work grouped locally but never active or joined across messages', () => {
  const invalid = { ...turn, state: 'invalid' as const };
  const a = member(0, 'Read', { presentation: invalid });
  const b = member(1, 'Edit', { presentation: { ...invalid } });
  expect(groups([a, b])).toEqual([{ type: 'activity', members: [a, b], active: false }]);
  expect(groups([a, { ...b, messageId: 'next' }])).toHaveLength(2);
});
