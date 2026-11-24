import { describe, expect, it } from 'vitest';
import { markerFacts, type MarkerContext } from '../marker-facts';
import { call } from './fixtures';

const context = (overrides: Partial<MarkerContext> = {}): MarkerContext => ({ pending: new Set(), ...overrides });
const facts = (...[name, args, overrides, ctx]: [string, Record<string, unknown>, object?, Partial<MarkerContext>?]) =>
  markerFacts(call(name, args, overrides), context(ctx));
const json = (value: unknown) => ({ result: JSON.stringify(value) });

describe('what each pill says', () => {
  it('names a skill and opens on its SKILL.md', () => {
    const skill = { skillName: 'p:design', path: '/s/SKILL.md', content: 'a\nb\n' };
    expect(facts('Skill', { skill: 'design', args: 'x' }, {}, { skill })).toMatchObject({
      label: 'Used skill',
      target: '/design',
      receipt: '2 lines',
      body: { type: 'skill', path: '/s/SKILL.md', content: 'a\nb\n', args: 'x' },
    });
    expect(facts('Skill', { skill: 'design' }).body).toBeUndefined();
  });

  it('shows a plan as its markdown, and says how an approved one is carried out', () => {
    expect(facts('ExitPlanMode', { plan: '# Plan' }, { result: 'Keep planning' })).toMatchObject({
      icon: 'plan',
      label: 'Updated plan',
      body: { type: 'markdown', text: '# Plan' },
    });
    const approved = { result: 'User has approved your plan.\n\n## Approved Plan:\n# Do it' };
    expect(facts('ExitPlanMode', {}, approved, { mode: 'Auto-Edits' })).toMatchObject({
      icon: 'plan-approved',
      label: 'Plan approved',
      target: 'implementing with Auto-Edits',
      body: { type: 'markdown', text: '# Do it' },
    });
  });

  it.each([
    [45, 'in 45s'],
    [1200, 'in 20m'],
    [90, 'in 1m 30s'],
    [5400, 'in 1h 30m'],
    [7200, 'in 2h'],
  ])('schedules a wakeup of %i s %s', (delaySeconds, target) =>
    expect(facts('ScheduleWakeup', { delaySeconds })).toMatchObject({ label: 'Scheduled a wakeup', target }),
  );

  it('reads a schedule from the result, else from the call', () => {
    expect(
      facts(
        'CronCreate',
        { cron: '0 9 * * *', prompt: 'Post' },
        json({ humanSchedule: 'daily at 9', recurring: true, durable: false }),
      ),
    ).toMatchObject({
      label: 'Scheduled',
      target: 'daily at 9',
      receipt: 'recurring · session-only',
      body: { text: 'Post' },
    });
    expect(facts('CronCreate', { cron: '0 9 * * *', recurring: false }, { result: 'ok' })).toMatchObject({
      target: '0 9 * * *',
      receipt: 'one-shot',
    });
  });

  it('lists jobs, and has nothing to open when there are none', () => {
    const listed = facts('CronList', {}, json([{ id: 'c1', cron: '0 9 * * *', recurring: true, prompt: 'Post' }]));
    expect(listed).toMatchObject({
      receipt: '1 job',
      body: { jobs: [{ id: 'c1', schedule: '0 9 * * *', cadence: 'recurring', prompt: 'Post' }] },
    });
    expect(facts('CronList', {}, json([]))).toMatchObject({ receipt: '0 jobs', body: undefined });
  });

  it('keeps a monitor running while its background task does', () => {
    const args = { command: 'pnpm dev' };
    expect(facts('Monitor', args, {}, { monitoring: true })).toMatchObject({ label: 'Monitoring', state: 'running' });
    expect(facts('Monitor', args)).toMatchObject({ label: 'Monitored', state: 'done', target: 'pnpm dev', mono: true });
    expect(facts('Monitor', { ...args, description: 'the build' })).toMatchObject({ target: 'the build', mono: false });
  });

  it('tells the three worktree operations apart', () => {
    expect(facts('EnterWorktree', {}, json({ worktreeBranch: 'feat/x' }))).toMatchObject({
      icon: 'worktree-enter',
      label: 'Entered worktree',
      target: 'feat/x',
    });
    expect(facts('ExitWorktree', { action: 'keep' })).toMatchObject({ icon: 'worktree-leave', receipt: 'kept' });
    expect(facts('ExitWorktree', { action: 'remove' })).toMatchObject({
      icon: 'worktree-remove',
      label: 'Removed worktree',
    });
  });

  it('shows a notification’s message and where it went', () => {
    expect(facts('PushNotification', { message: 'Done' }, { result: 'Sent to your phone' })).toMatchObject({
      label: 'Notified',
      target: 'Done',
      receipt: 'sent',
      body: { type: 'note', text: 'Done', detail: 'Sent to your phone' },
    });
  });
});

describe('how a pill stands', () => {
  it('speaks in the present while the call runs', () => {
    const running = { result: undefined, providerMetadata: { mainframe: { acpStatus: 'in_progress' } } };
    expect(facts('EnterWorktree', { name: 'x' }, running)).toMatchObject({
      label: 'Entering worktree',
      state: 'running',
    });
  });

  it('opens a failed call on its error', () => {
    expect(facts('EnterWorktree', { name: 'x' }, { isError: true, result: 'no such branch' })).toMatchObject({
      state: 'failed',
      receipt: 'failed',
      body: { type: 'error', text: 'no such branch' },
    });
  });
});
