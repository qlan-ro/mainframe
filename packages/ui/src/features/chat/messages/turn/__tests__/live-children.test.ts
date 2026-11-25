import { describe, expect, it } from 'vitest';
import type { BackgroundActivityTask, BackgroundTask } from '@qlan-ro/mainframe-types';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import type { TurnChild, TurnModel } from '../../../view-model/turn/types';
import { childCounts, childState, liveChildren, type ChildSources, type LiveChildren } from '../live-children';

const child = (overrides: Partial<TurnChild> = {}): TurnChild => ({
  toolCallId: 'call',
  kind: 'agent',
  status: 'success',
  ...overrides,
});
const task = (id: string, kind: BackgroundActivityTask['kind'] = 'agent'): BackgroundActivityTask => ({
  id,
  kind,
  description: id,
  startedAt: 1000,
});
const listed = (id: string, toolUseId: string, kind: BackgroundTask['kind'] = 'agent') =>
  ({ ...task(id, kind), toolUseId, status: 'running' }) as unknown as BackgroundTask;
const session = (status: string, custom: object = {}) =>
  ({ id: 'kid', custom: { delegation: { taskId: 't', role: 'review', status }, ...custom } }) as unknown as SessionItem;
const sources = (overrides: Partial<ChildSources> = {}): ChildSources => ({
  sessions: [],
  live: {},
  listed: [],
  ...overrides,
});

describe('a sub-agent', () => {
  it('is going while its call runs, and done once it came back', () => {
    expect(childState(child({ status: 'running' }), sources(), true)).toBe('running');
    expect(childState(child(), sources(), false)).toBeUndefined();
  });
  it('is not going when its call never came back and its turn ended', () => {
    expect(childState(child({ status: 'running' }), sources(), false)).toBeUndefined();
    const live = { bg: task('bg') };
    expect(childState(child({ status: 'running' }), sources({ live, listed: [listed('bg', 'call')] }), false)).toBe(
      'running',
    );
  });
  it('needs you while a call inside it waits for approval', () => {
    expect(childState(child({ status: 'awaiting-approval' }), sources(), true)).toBe('needs-you');
  });
  it('is going while it runs in the background, after its call returned', () => {
    const live = { bg: task('bg') };
    expect(childState(child(), sources({ live, listed: [listed('bg', 'call')] }), false)).toBe('running');
    expect(childState(child(), sources({ listed: [listed('bg', 'call')] }), false)).toBeUndefined();
  });
});

describe('a delegated task', () => {
  const kid = child({ taskChatId: 'kid' });
  it.each([
    ['queued', {}, 'queued'],
    ['running', {}, 'running'],
    ['waiting', {}, 'needs-you'],
    ['running', { hasPending: true }, 'needs-you'],
    ['running', { delegatedWaiting: true }, 'needs-you'],
    ['completed', {}, undefined],
    ['failed', {}, undefined],
    ['completed', { isRunning: true }, 'running'],
    ['cancelled', { isRunning: true }, undefined],
    ['failed', { isRunning: true }, undefined],
  ] as const)('%s %o → %s', (status, custom, expected) =>
    expect(childState(kid, sources({ sessions: [session(status, custom)] }), false)).toBe(expected),
  );
  it('is done once its result came back, whatever the list still says', () => {
    const results = new Map([['t', 'failed' as const]]);
    const sessions = [session('running')];
    expect(childState({ ...kid, taskId: 't' }, sources({ sessions, results }), true)).toBeUndefined();
  });
  it('holds nothing open when its chat is not in the list', () => {
    expect(childState(kid, sources(), false)).toBeUndefined();
  });
});

it('a workflow is going while its run is', () => {
  const flow = child({ kind: 'workflow', workflowTaskId: 'w1' });
  expect(childState(flow, sources({ live: { w1: task('w1', 'workflow') } }), false)).toBe('running');
  expect(childState(flow, sources(), false)).toBeUndefined();
});

describe('liveChildren', () => {
  const model = (children: TurnChild[]) =>
    ({ turns: new Map([['t', { children, live: false }]]), taskResults: new Map() }) as unknown as TurnModel;

  it('maps running background commands to the call that started them', () => {
    const live = liveChildren(
      model([]),
      sources({ live: { b: task('b', 'bash') }, listed: [listed('b', 'shell-call', 'bash')] }),
    );
    expect(live.background.get('shell-call')).toBe(1000);
    expect(live.byCall.size).toBe(0);
  });

  it('names the delegated tasks that failed', () => {
    const kid = child({ taskChatId: 'kid' });
    expect([...liveChildren(model([kid]), sources({ sessions: [session('failed')] })).failed]).toEqual(['call']);
    expect(liveChildren(model([kid]), sources({ sessions: [session('completed')] })).failed.size).toBe(0);
  });

  it('counts a task as failed by its delivered result, or by what a call that waited returned', () => {
    const delivered = child({ taskChatId: 'kid', taskId: 't' });
    const results = { ...model([delivered]), taskResults: new Map([['t', 'failed']]) } as unknown as TurnModel;
    expect([...liveChildren(results, sources({ sessions: [session('completed')] })).failed]).toEqual(['call']);
    const waited = model([child({ taskChatId: 'gone', taskStatus: 'failed' })]);
    expect([...liveChildren(waited, sources()).failed]).toEqual(['call']);
  });

  it('holds every turn open while an agent’s call is not known yet', () => {
    expect(liveChildren(model([]), sources({ live: { a: task('a') } })).unplacedAgents).toBe(true);
    const placed = sources({ live: { a: task('a') }, listed: [listed('a', 'x')] });
    expect(liveChildren(model([]), placed).unplacedAgents).toBe(false);
  });
});

it('counts child work, needs-you first', () => {
  const live: LiveChildren = {
    byCall: new Map([
      ['a', 'running'],
      ['b', 'needs-you'],
      ['c', 'queued'],
    ]),
    background: new Map(),
    failed: new Set(),
    unplacedAgents: false,
  };
  const children = ['a', 'b', 'c', 'd'].map((toolCallId) => child({ toolCallId }));
  expect(childCounts([...children, child({ toolCallId: 'w', kind: 'workflow' })], live)).toEqual({
    who: '4 agents, 1 workflow',
    needsYou: 1,
    running: 1,
    queued: 1,
  });
  expect(childCounts([], live)).toBeUndefined();
});
