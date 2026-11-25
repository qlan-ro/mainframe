import { expect, it } from 'vitest';
import type { ToolCallMessagePart } from '@assistant-ui/react';
import type { ChatThreadState } from '../../controller/chat-thread-state';
import { subagentOutcome } from '../subagent-outcome';

const call = (over: object = {}) =>
  ({ type: 'tool-call', toolCallId: 'a', toolName: 'Task', args: {}, argsText: '', ...over }) as ToolCallMessagePart;
const ended = (acpStatus: string, over: object = {}) =>
  call({ providerMetadata: { mainframe: { acpStatus } }, ...over });
const state = (over: object = {}) =>
  ({ interactions: { permissions: {} }, runState: { type: 'idle' }, backgroundTasks: {}, ...over }) as unknown as Pick<
    ChatThreadState,
    'interactions' | 'runState' | 'backgroundTasks'
  >;
const launched = ended('completed', { result: 'Async agent launched successfully.' });

it.each([
  ['runs with its turn', ended('in_progress'), state({ runState: { type: 'running' } }), 'going'],
  ['was cut short', ended('in_progress'), state(), 'stopped'],
  ['came back', ended('completed', { result: 'ok' }), state(), 'done'],
  ['failed', ended('failed', { result: 'no' }), state(), 'failed'],
  ['runs in the background', launched, state({ backgroundTasks: { b: { kind: 'agent' } } }), 'going'],
  ['ran in the background', launched, state(), 'done'],
  [
    'waits on you inside',
    ended('in_progress', { messages: [{ content: [call({ toolCallId: 'inner' })] }] }),
    state({ interactions: { permissions: { r: { request: { toolUseId: 'inner' } } } } }),
    'going',
  ],
] as const)('%s', (_name, part, at, expected) => expect(subagentOutcome(part, at)).toBe(expected));
