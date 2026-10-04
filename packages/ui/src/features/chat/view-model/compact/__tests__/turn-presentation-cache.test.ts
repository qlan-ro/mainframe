import { afterEach, expect, it, vi } from 'vitest';
import type { ThreadAssistantMessage, ToolCallMessagePart } from '@assistant-ui/react';
import type { TranscriptPresentation } from '@qlan-ro/mainframe-types';
import { buildTurnDisclosures } from '../build-turn-disclosures';
import { TurnPresentationCache } from '../turn-presentation-cache';
import * as activity from '../build-activity-groups';
import type { NativePartSource } from '../../transcript-presentation';

const scope = { rootThreadId: 'root', ancestors: [], pendingToolIds: new Set<string>() };
function tool(id: string): ToolCallMessagePart {
  return {
    type: 'tool-call',
    toolCallId: id + '-call',
    toolName: 'Read',
    args: { file_path: '/a.ts' },
    argsText: '{}',
    result: 'file',
    providerMetadata: { mainframe: { acpStatus: 'completed' } },
  };
}
function message(
  id: string,
  text = 'Answer',
  patch: Partial<TranscriptPresentation> = {},
  mapped = true,
): ThreadAssistantMessage {
  const presentation: TranscriptPresentation = {
    version: 1,
    provider: 'codex',
    turnId: id,
    phase: 'work',
    state: 'completed',
    finalEligible: false,
    ...patch,
  };
  const source: NativePartSource = { sourceMessageId: id, sourceBlockIndex: 0, presentation };
  return {
    id,
    role: 'assistant',
    createdAt: new Date(0),
    status: { type: 'complete', reason: 'stop' },
    content: [tool(id), { type: 'text', text }],
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: mapped
        ? {
            mainframe: {
              partSources: {
                0: [source],
                1: [
                  {
                    ...source,
                    sourceBlockIndex: 1,
                    startUtf16: 0,
                    endUtf16: text.length,
                    presentation: { ...presentation, phase: 'final_answer', finalEligible: true, ...patch },
                  },
                ],
              },
            },
          }
        : {},
    },
  };
}
afterEach(() => vi.restoreAllMocks());
it.each([true, false])(
  'reuses unchanged historical references and rebuilds only the active chunk (mapped=%s)',
  (mapped) => {
    const cache = new TurnPresentationCache();
    const build = vi.spyOn(activity, 'buildActivityGroups');
    const history = Array.from({ length: 100 }, (_, index) => message(`history-${index}`, 'Answer', {}, mapped));
    const first = buildTurnDisclosures([...history, message('active', 'Before', {}, mapped)], scope, 10000, cache);
    build.mockClear();
    const second = buildTurnDisclosures([...history, message('active', 'After', {}, mapped)], scope, 10000, cache);
    for (const item of history) expect(second.messagesById.get(item.id)).toBe(first.messagesById.get(item.id));
    for (const [key, turn] of first.turns) if (!key.includes('active')) expect(second.turns.get(key)).toBe(turn);
    expect(build.mock.calls.flatMap(([members]) => members).every((unit) => unit.messageId === 'active')).toBe(true);
    expect(build.mock.calls.reduce((sum, [members]) => sum + members.length, 0)).toBe(2);
    expect(second.messagesById.get('active')).not.toBe(first.messagesById.get('active'));
  },
);
it('invalidates changed permissions and scope but retains equivalent pending sets', () => {
  const cache = new TurnPresentationCache();
  const messages = [message('one')];
  const first = buildTurnDisclosures(messages, scope, 10000, cache);
  const equivalent = buildTurnDisclosures(messages, { ...scope, pendingToolIds: new Set() }, 10000, cache);
  expect(equivalent.messages[0]).toBe(first.messages[0]);
  const pending = buildTurnDisclosures(messages, { ...scope, pendingToolIds: new Set(['one-call']) }, 10000, cache);
  expect(pending.messages[0]!.units[0]).toMatchObject({ protected: true, work: false });
  expect(pending.messages[0]!.units[0]!.activity).toBeUndefined();
  const nested = buildTurnDisclosures(
    messages,
    { ...scope, ancestors: ['child'], rootThreadId: 'other' },
    10000,
    cache,
  );
  expect(nested.messages[0]).not.toBe(first.messages[0]);
  expect([...nested.turns.keys()][0]).not.toBe([...first.turns.keys()][0]);
});
it('recomputes eligibility after metadata updates and removes absent cached messages and turns', () => {
  const cache = new TurnPresentationCache();
  const a = message('a'),
    b = message('b');
  const first = buildTurnDisclosures([a, b], scope, 10000, cache);
  const removed = buildTurnDisclosures([a], scope, 10000, cache);
  expect(removed.messagesById.has('b')).toBe(false);
  expect(removed.turns.size).toBe(1);
  const noFinal = buildTurnDisclosures([a, message('b', 'Answer', { finalEligible: false })], scope, 10000, cache);
  expect([...noFinal.turns.values()][1]!.available).toBe(true);
  expect(noFinal.messagesById.get('b')).not.toBe(first.messagesById.get('b'));
  const invalid = buildTurnDisclosures([message('a', 'Answer', { state: 'invalid' }), b], scope, 10000, cache);
  expect([...invalid.turns.values()][0]).toMatchObject({ invalid: true, unsafe: true });
});
it('recomputes interrupted turn membership after reorder without changing source identity', () => {
  const cache = new TurnPresentationCache();
  const a = message('a', 'Answer', { turnId: 'shared' }),
    b = message('b', 'Answer', { turnId: 'shared' }),
    other = message('other');
  const interrupted = buildTurnDisclosures([a, other, b], scope, 10000, cache);
  expect([...interrupted.turns.values()][0]!.unsafe).toBe(true);
  const ordered = buildTurnDisclosures([a, b, other], scope, 10000, cache);
  expect([...ordered.turns.values()][0]!.unsafe).toBe(false);
  expect(ordered.messages.map((entry) => entry.messageId)).toEqual(['a', 'b', 'other']);
  expect(ordered.messagesById.get('a')!.units[0]!.key).toBe(interrupted.messagesById.get('a')!.units[0]!.key);
});

it('refreshes cached live state in tool gaps without activating historical groups', () => {
  const cache = new TurnPresentationCache();
  const messages = ['old', 'latest'].map((id) => ({ ...message(id, '', {}, false), content: [tool(id)] }));
  const settled = buildTurnDisclosures(messages, scope, 10000, cache);
  const live = buildTurnDisclosures(messages, { ...scope, isRunning: true }, 10000, cache);
  expect(settled.messages[1]!.units[0]!.activity!.group.active).toBe(false);
  expect(live.messages[0]!.units[0]!.activity!.group.active).toBe(false);
  expect(live.messages[1]!.units[0]!.activity!.group.active).toBe(true);
  const finished = buildTurnDisclosures(messages, scope, 10000, cache);
  expect(finished.messages[1]!.units[0]!.activity!.group.active).toBe(false);
});
