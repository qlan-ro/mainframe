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
  const back = [user('u1', 'Go'), assistant('a1', [launched])];
  const then: ThreadMessage[] = [user('u2', 'Next'), assistant('a2', [text('Hi')])];
  const at = (over: object) =>
    zoneScope({
      interactions: { permissions: {}, queued: {} },
      runState: { type: 'running' },
      run: null,
      ...over,
    } as Pick<ChatThreadState, 'interactions' | 'runState' | 'run'>);
  const since = (after: string | null) => ({ run: { after, confirmed: true } });

  it('follows the transcript’s own rule', () => {
    expect(callLive(first, 'a', at({}))).toBe(true);
    expect(callLive(first, 'a', at({ runState: { type: 'cancelling' } }))).toBe(true);
    expect(callLive(first, 'a', at({ runState: { type: 'idle' } }))).toBe(false);
    // Its call has no outcome, so it may go on; one that came back goes on with its part alone.
    expect(callLive([...first, ...then], 'a', at(since('a1')))).toBe(true);
    expect(callLive([...back, ...then], 'a', at(since('a1')))).toBe(false);
    expect(callLive([...back, ...then], 'a', at(since(null)))).toBe(true);
    expect(callLive([...back, ...then], 'a', at({}))).toBe(false);
  });

  it('is that of the agent around a nested one', () => {
    const nested = assistant('n', [call({ toolCallId: 'inner' })]);
    const around = [user('u1', 'Go'), assistant('a1', [ended('in_progress', { messages: [nested] })])];
    expect(callLive(around, 'inner', at({}))).toBe(true);
    expect(callLive([...around, ...then], 'inner', at(since('a1')))).toBe(true);
    const done = [user('u1', 'Go'), assistant('a1', [ended('completed', { result: 'ok', messages: [nested] })])];
    expect(callLive([...done, ...then], 'inner', at(since('a1')))).toBe(false);
  });

  it('is the session’s while the call is not loaded', () => {
    expect(callLive([], 'a', at({}))).toBe(true);
    expect(callLive([], 'a', at({ runState: { type: 'idle' } }))).toBe(false);
  });
});
