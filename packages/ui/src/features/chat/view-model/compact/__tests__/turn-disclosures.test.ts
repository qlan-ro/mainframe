import { expect, it } from 'vitest';
import type { ThreadAssistantMessage, ThreadMessage } from '@assistant-ui/react';
import type { TranscriptPresentation } from '@qlan-ro/mainframe-types';
import { buildTurnDisclosures } from '../build-turn-disclosures';
import type { NativePartSource } from '../../transcript-presentation';

const scope = { rootThreadId: 'root', ancestors: [], pendingToolIds: new Set<string>() };
const context: TranscriptPresentation = {
  version: 1,
  provider: 'codex',
  turnId: 'turn',
  phase: 'work',
  state: 'completed',
  finalEligible: false,
};
function message(
  id: string,
  text: string,
  phase: TranscriptPresentation['phase'] = 'work',
  patch: Partial<TranscriptPresentation> = {},
): ThreadAssistantMessage {
  const source: NativePartSource = {
    sourceMessageId: id,
    sourceBlockIndex: 0,
    startUtf16: 0,
    endUtf16: text.length,
    presentation: { ...context, phase, finalEligible: phase === 'final_answer', ...patch },
  };
  return {
    id,
    role: 'assistant',
    createdAt: new Date(0),
    content: [{ type: 'text', text }],
    status: { type: 'complete', reason: 'stop' },
    metadata: {
      custom: { mainframe: { partSources: { 0: [source] } } },
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
    },
  };
}
const first = (messages: ThreadMessage[]) => [...buildTurnDisclosures(messages, scope, 10000).turns.values()][0]!;
it('folds only explicit eligible final sources and keeps unknown sources visible', () => {
  const work = message('work', 'Working');
  expect(first([work, message('final', 'Answer', undefined, { phase: undefined })]).available).toBe(false);
  expect(first([work, message('final', 'Answer', 'final_answer', { state: 'running' })]).available).toBe(true);
  expect(first([work, message('final', 'Answer', 'final_answer', { finalEligible: false })]).available).toBe(true);
});
it('requires confirmed Claude success and never crosses source turn, provider or ancestor identities', () => {
  const work = message('work', 'Working', 'work', { provider: 'claude' });
  expect(
    first([work, message('final', 'Answer', 'final_answer', { provider: 'claude', state: 'running' })]).available,
  ).toBe(false);
  expect(first([work, message('final', 'Answer', 'final_answer', { provider: 'claude' })]).available).toBe(true);
  expect(first([work, message('final', 'Answer', 'final_answer', { provider: 'codex' })]).available).toBe(false);
  expect(
    first([work, message('final', 'Answer', 'final_answer', { provider: 'claude', turnId: 'other' })]).available,
  ).toBe(false);
  const nested = buildTurnDisclosures([work], { ...scope, ancestors: ['parent'] });
  expect([...nested.turns.keys()][0]).not.toBe(first([work]).key);
});
it.each(['cancelled', 'failed', 'invalid'] as const)(
  'forces %s work open and retains the invalid tombstone signal',
  (state) => {
    const result = first([message('work', 'Working'), message('final', 'Answer', 'final_answer', { state })]);
    expect(result.unsafe).toBe(true);
    expect(result.invalid).toBe(state === 'invalid');
  },
);
it('preserves every separator and maps each grouped work control to an actual display slot', () => {
  const reasoning = (id: string) => ({
    ...message(id, 'Think'),
    content: [{ type: 'reasoning' as const, text: 'Think' }],
  });
  const messages = [
    reasoning('a'),
    reasoning('b'),
    message('space', '\n\n'),
    message('final', 'Answer', 'final_answer'),
  ];
  const model = buildTurnDisclosures(messages, scope);
  const slots = model.messages.flatMap((entry) => entry.units.map((unit) => unit.key));
  const turn = [...model.turns.values()][0]!;
  expect(model.messages[2]!.units[0]?.part).toMatchObject({ type: 'text', text: '\n\n' });
  expect(turn.workKeys.every((key) => slots.includes(key))).toBe(true);
});
it('rejects interrupted identities and unreliable timing instead of guessing', () => {
  const work = message('work', 'Working', 'work', { timing: { startedAtMs: 100 } });
  const final = message('final', 'Answer', 'final_answer', { timing: { completedAtMs: 500, durationMs: 400 } });
  expect(first([work, final]).timing).toEqual({ startedAtMs: 100, completedAtMs: 500, durationMs: 400 });
  expect(first([work, message('other', 'Other', 'work', { turnId: 'other' }), final]).unsafe).toBe(true);
  expect(
    first([work, message('final', 'Answer', 'final_answer', { timing: { completedAtMs: 10001 } })]).timing,
  ).toBeUndefined();
});
it('does not use adjacent users or system steering to infer a turn and keeps unrelated histories local', () => {
  const work = message('work', 'Work');
  const user: ThreadMessage = {
    id: 'user',
    role: 'user',
    createdAt: new Date(0),
    content: [{ type: 'text', text: 'Steer' }],
    attachments: [],
    metadata: { custom: {} },
  };
  expect(first([work, user, message('final', 'Answer', 'final_answer')]).unsafe).toBe(true);
  const unknown = { ...work, metadata: { ...work.metadata, custom: {} } };
  const model = buildTurnDisclosures([unknown, message('final', 'Answer', 'final_answer')], scope);
  expect([...model.turns.values()][0]!.available).toBe(false);
  expect(model.messages[0]!.units[0]!.work).toBe(false);
});

it('folds confirmed Codex work at completion without inferring a Claude final boundary', () => {
  expect(first([message('work', 'Progress')]).available).toBe(true);
  expect(first([message('work', 'Progress', 'work', { state: 'running' })]).available).toBe(false);
  expect(first([message('work', 'Progress', 'work', { provider: 'claude' })]).available).toBe(false);
});
it('folds completed unfamiliar tools but protects unfamiliar lifecycle states', () => {
  const base = message('custom', '');
  const custom = (result: string | undefined): ThreadAssistantMessage => ({
    ...base,
    content: [
      { type: 'tool-call', toolCallId: 'custom', toolName: 'CustomAnalytics', args: {}, argsText: '{}', result },
    ],
  });
  const complete = buildTurnDisclosures([custom('done'), message('final', 'Answer', 'final_answer')], scope);
  expect(complete.messages[0]!.units[0]).toMatchObject({ work: true, protected: false });
  expect(complete.messages[0]!.units[0]!.activity).toBeUndefined();
  expect([...complete.turns.values()][0]!.available).toBe(true);
  const unknown = buildTurnDisclosures([custom(undefined), message('final', 'Answer', 'final_answer')], scope);
  expect(unknown.messages[0]!.units[0]).toMatchObject({ work: false, protected: true });
});
