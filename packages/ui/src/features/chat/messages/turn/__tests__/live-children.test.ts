import { describe, expect, it } from 'vitest';
import type { BackgroundActivityTask, BackgroundTask } from '@qlan-ro/mainframe-types';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import type { TurnChild, TurnModel } from '../../../view-model/turn/types';
import {
  NO_CHILDREN,
  childCounts,
  childState,
  liveChildren,
  sameLive,
  type ChildSources,
  type LiveChildren,
} from '../live-children';

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
  listLive: true,
  runs: true,
  ...overrides,
});
const call = (over: object = {}) => ({ pending: false, open: false, failed: false, cancelled: false, ...over });

describe('a sub-agent', () => {
  const agent = (over: object = {}) => child({ call: call(over) });
  const open = agent({ open: true });
  it('is going while its call is open, and done once it came back', () => {
    expect(childState(open, sources(), true)).toBe('running');
    expect(childState(agent(), sources(), true)).toBeUndefined();
  });
  it('is not going when its call never came back and its turn, or the session, ended', () => {
    expect(childState(open, sources(), false)).toBeUndefined();
    expect(childState(open, sources({ runs: false }), true)).toBeUndefined();
    expect(childState(open, sources({ listed: [listed('bg', 'call')] }), false)).toBe('running');
  });
  it('needs you while a call inside it waits for approval', () => {
    expect(childState(agent({ pending: true }), sources(), true)).toBe('needs-you');
  });
  it('is going while the list says so, after its call returned, as its row and its tab read it', () => {
    const running = sources({ runs: false, listed: [listed('bg', 'call')] });
    expect(childState(agent(), running, false)).toBe('running');
    expect(childState(agent(), { ...running, listLive: false }, false)).toBeUndefined();
    expect(childState(agent(), { ...running, listed: [listed('bg', 'other')] }, false)).toBeUndefined();
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

  it('counts an agent whose task failed, once: a call that says so itself is a failed step', () => {
    const how = (status: string, over = {}) => {
      const ended = { ...listed('a', 'call'), status } as BackgroundTask;
      return liveChildren(model([child({ call: call(over) })]), sources({ listed: [ended] })).failed.size;
    };
    expect(how('failed')).toBe(1);
    expect(how('failed', { failed: true })).toBe(0);
    expect(how('stopped')).toBe(0);
    expect(how('completed')).toBe(0);
  });

  it('names the agents nothing says the end of: not their call, nor the list', () => {
    const open = child({ status: 'unknown', call: call({ open: true }) });
    const unknown = (kid: TurnChild, status?: string) =>
      liveChildren(
        model([kid]),
        sources({ runs: false, listed: status ? [{ ...listed('a', 'call'), status } as BackgroundTask] : [] }),
      ).unknown.size;
    expect(unknown(open)).toBe(1);
    expect(unknown(open, 'stopped')).toBe(0);
    expect(unknown(open, 'failed')).toBe(0);
    expect(unknown(open, 'running')).toBe(0);
    expect(unknown({ ...open, call: call({ open: true, cancelled: true }) })).toBe(0);
    expect(unknown(child({ status: 'success', call: call() }))).toBe(0);
    expect(unknown(child({ status: 'unknown' }))).toBe(0);
  });

  it('is another object once what is known of an end moved', () => {
    const a = { ...NO_CHILDREN, unknown: new Set(['a']) };
    expect(sameLive(a, { ...NO_CHILDREN, unknown: new Set(['a']) })).toBe(true);
    expect(sameLive(a, { ...NO_CHILDREN, unknown: new Set(['b']) })).toBe(false);
    expect(sameLive(a, NO_CHILDREN)).toBe(false);
  });

  it('holds every turn open while an agent’s call is not known yet', () => {
    expect(liveChildren(model([]), sources({ live: { a: task('a') } })).unplacedAgents).toBe(true);
    const placed = sources({ live: { a: task('a') }, listed: [listed('a', 'x')] });
    expect(liveChildren(model([]), placed).unplacedAgents).toBe(false);
    expect(liveChildren(model([]), sources({ live: { a: task('a') }, listed: null })).unplacedAgents).toBe(true);
  });

  it('and while the list that says an agent runs has stopped counting', () => {
    const stale = sources({ listed: [listed('a', 'x')], listLive: false });
    expect(liveChildren(model([]), stale).unplacedAgents).toBe(true);
    expect(liveChildren(model([]), { ...stale, listed: [listed('b', 'x', 'bash')] }).unplacedAgents).toBe(false);
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
    unknown: new Set(),
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
