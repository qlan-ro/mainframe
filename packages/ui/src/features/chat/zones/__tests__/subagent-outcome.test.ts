import { describe, expect, it } from 'vitest';
import type { ThreadMessage, ToolCallMessagePart } from '@assistant-ui/react';
import type { ChatThreadState } from '../../controller/chat-thread-state';
import { assistant, text, user } from '../../view-model/turn/__tests__/fixtures';
import { callLive, subagentOutcome, zoneScope, type OutcomeSources } from '../subagent-outcome';

const call = (over: object = {}) =>
  ({ type: 'tool-call', toolCallId: 'a', toolName: 'Task', args: {}, argsText: '', ...over }) as ToolCallMessagePart;
const ended = (acpStatus: string, over: object = {}) =>
  call({ providerMetadata: { mainframe: { acpStatus } }, ...over });
const launched = ended('completed', { result: 'Async agent launched successfully.' });
const task = (over: object = {}) => ({ id: 'bg', kind: 'agent', toolUseId: 'a', status: 'running', ...over });
const sources = (over: object = {}) =>
  ({ pending: new Set(), live: false, running: {}, listed: [], ...over }) as unknown as OutcomeSources;
const bg = { bg: { id: 'bg', kind: 'agent' } };

it.each([
  ['runs with its turn', ended('in_progress'), sources({ live: true }), 'going'],
  ['was cut short', ended('in_progress'), sources(), 'stopped'],
  ['came back', ended('completed', { result: 'ok' }), sources(), 'done'],
  ['failed', ended('failed', { result: 'no' }), sources(), 'failed'],
  ['runs in the background', launched, sources({ running: bg, listed: [task()] }), 'going'],
  ['ran in the background', launched, sources({ listed: [task({ status: 'completed' })] }), 'done'],
  ['is listed as running by a list older than its end', launched, sources({ listed: [task()] }), 'done'],
  ['was stopped in the background', launched, sources({ listed: [task({ status: 'stopped' })] }), 'stopped'],
  ['failed in the background', launched, sources({ listed: [task({ status: 'failed' })] }), 'failed'],
  [
    'has a recovered task’s guess',
    launched,
    sources({ listed: [task({ status: 'failed', recovered: true })] }),
    'done',
  ],
  [
    'ended while another agent runs',
    launched,
    sources({ running: bg, listed: [task({ toolUseId: 'other' })] }),
    'done',
  ],
  ['came back while an agent runs', ended('completed', { result: 'ok' }), sources({ running: bg }), 'done'],
  [
    'waits on you inside',
    ended('in_progress', { messages: [{ content: [call({ toolCallId: 'inner' })] }] }),
    sources({ pending: new Set(['inner']) }),
    'going',
  ],
  ['waits on you itself', ended('in_progress'), sources({ pending: new Set(['a']) }), 'going'],
] as const)('%s', (_name, part, at, expected) => expect(subagentOutcome(part, at)).toBe(expected));

describe('whether its turn part can still be going', () => {
  const open = ended('in_progress');
  const first = [user('u1', 'Go'), assistant('a1', [open])];
  const later: ThreadMessage[] = [...first, user('u2', 'Next'), assistant('a2', [text('Hi')])];
  const at = (over: object) =>
    zoneScope({
      interactions: { permissions: {}, queued: {} },
      runState: { type: 'running' },
      runs: [],
      ...over,
    } as Pick<ChatThreadState, 'interactions' | 'runState' | 'runs'>);
  const next = [{ after: { id: 'a1', parts: 1 }, exact: true }];

  it('follows the transcript’s own rule', () => {
    expect(callLive(first, 'a', at({}))).toBe(true);
    expect(callLive(first, 'a', at({ runState: { type: 'cancelling' } }))).toBe(true);
    expect(callLive(first, 'a', at({ runState: { type: 'idle' } }))).toBe(false);
    expect(callLive(later, 'a', at({ runs: next }))).toBe(false);
    expect(callLive(later, 'a', at({ runs: [{ after: null, exact: true }] }))).toBe(true);
    expect(callLive(later, 'a', at({}))).toBe(true);
  });

  it('is that of the agent around a nested one', () => {
    const nested = assistant('n', [call({ toolCallId: 'inner' })]);
    const around = [user('u1', 'Go'), assistant('a1', [ended('in_progress', { messages: [nested] })])];
    expect(callLive(around, 'inner', at({}))).toBe(true);
    expect(callLive([...around, user('u2', 'Next')], 'inner', at({ runs: next }))).toBe(false);
  });

  it('is the session’s while the call is not loaded', () => {
    expect(callLive([], 'a', at({}))).toBe(true);
    expect(callLive([], 'a', at({ runState: { type: 'idle' } }))).toBe(false);
  });
});
