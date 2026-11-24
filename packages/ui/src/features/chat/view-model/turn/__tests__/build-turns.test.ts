import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import { buildTurns } from '../build-turns';
import { TurnCache } from '../turn-cache';
import type { TurnModel, TurnScope, TurnUnit } from '../types';
import { assistant, bash, call, presented, scope, sources, system, text, thought, user } from './fixtures';

const NOW = 1_700_000_100_000;
const build = (messages: ThreadMessage[], options: Partial<TurnScope> = {}, cache?: TurnCache) =>
  buildTurns(messages, scope(options), cache, NOW);
const only = (model: TurnModel) => {
  expect(model.turns.size).toBe(1);
  return [...model.turns.values()][0]!;
};
const label = ({ part }: TurnUnit) =>
  part.type === 'tool-call' ? part.toolName : part.type === 'text' ? part.text : part.type;
const roles = (model: TurnModel, id: string) => {
  const slice = model.slices.get(id)!;
  return { work: slice.work.map(label), markers: slice.markers.map(label), answer: slice.answer.map(label) };
};

describe('what a turn is', () => {
  it('folds everything between two user messages into one turn', () => {
    const model = build([
      user('u1'),
      assistant('a1', [bash('ls'), text('Done')]),
      user('u2'),
      assistant('a2', [text('Hi')]),
    ]);
    expect(model.turns.size).toBe(2);
    expect([...model.turns.values()].map((turn) => turn.hasWork)).toEqual([true, false]);
  });

  it('keeps one work row across messages split by a compaction', () => {
    const model = build([
      user('u1'),
      assistant('a1', [bash('one')]),
      system('s1', { isCompacted: true }),
      assistant('a2', [bash('two'), text('Done')]),
    ]);
    only(model);
    expect(model.slices.get('a1')!.header).toBe(true);
    expect(model.slices.get('a2')!.header).toBe(false);
    expect(model.slices.get('a1')!.footer).toBe(false);
    expect(model.slices.get('a2')!.footer).toBe(true);
  });

  it('starts another turn when the provider did, with no user message between', () => {
    const first = assistant('a1', [text('Waiting')], { partSources: sources(1, presented({ turnId: 't1' })) });
    const second = assistant('a2', [text('It came back')], { partSources: sources(1, presented({ turnId: 't2' })) });
    expect(build([user('u1'), first, second]).turns.size).toBe(2);
  });

  it('does not let a queued prompt end the running turn', () => {
    const model = build([user('u1'), assistant('a1', [bash('ls')]), user('q1', 'next', { queued: true })], {
      isRunning: true,
    });
    expect(only(model).running).toBe(true);
    expect(model.runningKey).toBe(only(model).key);
  });

  it('ends at a provider switch', () => {
    const model = build([
      user('u1'),
      assistant('a1', [text('A')]),
      system('s1', { providerSwitch: {} }),
      assistant('a2', [text('B')]),
    ]);
    expect(model.turns.size).toBe(2);
  });
});

describe('steps, markers and the answer', () => {
  it('puts text between steps inside the work and keeps the final text out', () => {
    const model = build([
      user('u1'),
      assistant('a1', [
        text('Looking'),
        bash('ls'),
        text('Now the fix'),
        call('Edit', { file_path: 'a' }),
        text('Fixed.'),
      ]),
    ]);
    expect(roles(model, 'a1')).toEqual({
      work: ['Looking', 'Bash', 'Now the fix', 'Edit'],
      markers: [],
      answer: ['Fixed.'],
    });
  });

  it('takes event tools and questions out of the work', () => {
    const model = build([
      user('u1'),
      assistant('a1', [
        call('Skill', { skill: 'x' }),
        bash('ls'),
        call('AskUserQuestion', {}),
        call('Monitor', {}),
        text('Done'),
      ]),
    ]);
    expect(roles(model, 'a1')).toEqual({
      work: ['Bash'],
      markers: ['Skill', 'AskUserQuestion', 'Monitor'],
      answer: ['Done'],
    });
  });

  it('keeps the closing text as the answer when a marker follows it', () => {
    const model = build([
      user('u1'),
      assistant('a1', [bash('ls'), text("I'll check back."), call('ScheduleWakeup', { delaySeconds: 60 })]),
    ]);
    expect(roles(model, 'a1').answer).toEqual(["I'll check back."]);
  });

  it('turns streaming text into a step once another step follows it', () => {
    const before = build([user('u1'), assistant('a1', [text('Checking')])], { isRunning: true });
    expect(roles(before, 'a1')).toEqual({ work: [], markers: [], answer: ['Checking'] });
    const after = build([user('u1'), assistant('a1', [text('Checking'), bash('ls')])], { isRunning: true });
    expect(roles(after, 'a1')).toEqual({ work: ['Checking', 'Bash'], markers: [], answer: [] });
  });

  it('answers with the last text of an ended turn even when it went on working', () => {
    const model = build([user('u1'), assistant('a1', [bash('ls'), text('Done'), thought()])]);
    expect(roles(model, 'a1')).toEqual({ work: ['Bash', 'reasoning'], markers: [], answer: ['Done'] });
  });

  it('finds the answer in a later message of the turn', () => {
    const model = build([
      user('u1'),
      assistant('a1', [text('First'), bash('ls')]),
      system('s1', { isCompacted: true }),
      assistant('a2', [text('Final')]),
    ]);
    expect(roles(model, 'a1').work).toEqual(['First', 'Bash']);
    expect(roles(model, 'a2').answer).toEqual(['Final']);
  });

  it('has no work row for a plain reply, nor for one with markers alone', () => {
    expect(only(build([user('u1'), assistant('a1', [text('Hi')])])).hasWork).toBe(false);
    const model = build([user('u1'), assistant('a1', [call('Skill', { skill: 'x' }), text('Hi')])]);
    expect(only(model).hasWork).toBe(false);
    expect(model.slices.get('a1')!.header).toBe(false);
  });
});

describe('how a turn ended', () => {
  it('is done, stopped or failed by what the provider reported', () => {
    const turn = (state: 'completed' | 'cancelled' | 'failed') =>
      only(build([user('u1'), assistant('a1', [bash('ls')], { partSources: sources(1, presented({ state })) })])).end;
    expect(turn('completed')).toBe('done');
    expect(turn('cancelled')).toBe('stopped');
    expect(turn('failed')).toBe('error');
  });

  it('is an error when an error message closes it', () => {
    const model = build([
      user('u1'),
      assistant('a1', [bash('ls')]),
      assistant('e1', [text('Boom')], { errorText: 'Boom' }),
    ]);
    expect(only(model).end).toBe('error');
  });

  it('is stopped when its last step was cut short', () => {
    const cut = bash('sleep 60', { result: undefined, providerMetadata: { mainframe: { acpStatus: 'cancelled' } } });
    expect(only(build([user('u1'), assistant('a1', [cut])])).end).toBe('stopped');
  });

  it('reads the duration from the provider, else from the messages', () => {
    const timing = { startedAtMs: 1_700_000_000_000, completedAtMs: 1_700_000_072_000 };
    const provider = assistant('a1', [bash('ls')], { partSources: sources(1, presented({ timing })) });
    expect(only(build([user('u1'), provider])).durationMs).toBe(72_000);
    const native = assistant('a1', [bash('ls')], undefined, {
      metadata: { custom: {}, timing: { totalStreamTime: 900 } },
    });
    expect(only(build([user('u1'), native])).durationMs).toBe(900);
  });
});

describe('failed steps', () => {
  const fail = { isError: true } as const;

  it('counts a failure as retried when the same tool later succeeds on the same target', () => {
    const turn = only(
      build([
        user('u1'),
        assistant('a1', [bash('vitest', { ...fail, toolCallId: 'bad' }), bash('vitest'), text('ok')]),
      ]),
    );
    expect(turn.failed).toEqual([]);
    expect(turn.retried).toEqual(['bad']);
  });

  it('keeps it failed for another target, an earlier success or a second failure', () => {
    const steps = [
      bash('lint'),
      bash('lint', { ...fail, toolCallId: 'after-success' }),
      bash('vitest', { ...fail, toolCallId: 'twice-1' }),
      bash('vitest', { ...fail, toolCallId: 'twice-2' }),
      bash('other'),
    ];
    const turn = only(build([user('u1'), assistant('a1', steps)]));
    expect(turn.failed).toEqual(['after-success', 'twice-1', 'twice-2']);
    expect(turn.retried).toEqual([]);
  });

  it('compares the arguments of tools that name no target', () => {
    const issue = (n: number, over = {}) => call('mcp__github__get_issue', { issue_number: n }, over);
    const turn = only(
      build([user('u1'), assistant('a1', [issue(8470, { ...fail, toolCallId: 'wrong' }), issue(847), text('ok')])]),
    );
    expect(turn.failed).toEqual(['wrong']);
  });
});

describe('child work', () => {
  it('lists agents, delegated tasks and workflows, never monitors or commands', () => {
    const turn = only(
      build([
        user('u1'),
        assistant('a1', [
          call('Task', {}, { toolCallId: 'agent' }),
          call(
            'mcp__mainframe__delegate_task',
            {},
            { toolCallId: 'task', result: undefined, providerMetadata: { mainframe: { acpStatus: 'in_progress' } } },
          ),
          call('Workflow', {}, { toolCallId: 'flow' }),
          call('Monitor', {}),
          bash('sleep 60', { args: { command: 'sleep', run_in_background: true } }),
        ]),
      ]),
    );
    expect(turn.children).toEqual([
      { toolCallId: 'agent', kind: 'agent', status: 'success' },
      { toolCallId: 'task', kind: 'agent', status: 'running' },
      { toolCallId: 'flow', kind: 'workflow', status: 'success' },
    ]);
    expect(turn.summary).toBe('ran 1 command');
  });
});

describe('messages another element stands for', () => {
  const skill = { skillName: 'plugin:design', path: '/s/SKILL.md', content: '# Design' };
  const result = (task: string, body = 'All good') =>
    `<mainframe-task-result task="${task}" chat="child" status="completed">\n${body}\n</mainframe-task-result>`;
  const card = (taskId: string) =>
    call(
      'mcp__mainframe__delegate_task',
      {},
      { result: JSON.stringify({ taskId, childChatId: 'child', status: 'running' }) },
    );

  it("absorbs a skill's text into its marker without splitting the turn", () => {
    const model = build([
      user('u1'),
      assistant('a1', [call('Skill', { skill: 'design' }, { toolCallId: 'skill' })]),
      system('s1', { skillLoaded: skill }),
      assistant('a2', [text('Done')]),
    ]);
    only(model);
    expect([...model.absorbed]).toEqual(['s1']);
    expect(model.skills.get('skill')).toEqual(skill);
  });

  it('leaves a skill the user invoked alone', () => {
    const model = build([user('u1'), system('s1', { skillLoaded: skill }), assistant('a1', [text('Done')])]);
    expect(model.absorbed.size).toBe(0);
  });

  it('absorbs a task result whose card is loaded, and starts a new turn after it', () => {
    const model = build([
      user('u1'),
      assistant('a1', [card('t1'), text('Started')]),
      user('r1', result('t1')),
      assistant('a2', [text('It is back')]),
    ]);
    expect([...model.absorbed]).toEqual(['r1']);
    expect(model.turns.size).toBe(2);
  });

  it('keeps a result whose card is outside the loaded window', () => {
    const model = build([user('r1', result('t1')), assistant('a1', [text('It is back')])]);
    expect(model.absorbed.size).toBe(0);
  });

  it('keeps a batch when any of its tasks has no card', () => {
    const model = build([user('u1'), assistant('a1', [card('t1')]), user('r1', `${result('t1')}\n${result('t2')}`)]);
    expect(model.absorbed.size).toBe(0);
  });
});

describe('identity across streamed chunks', () => {
  it('keeps every untouched turn, slice and unit object', () => {
    const cache = new TurnCache();
    const first = [user('u1'), assistant('a1', [bash('ls', { toolCallId: 'x' }), text('One')]), user('u2')];
    const step = bash('pwd', { toolCallId: 'y' });
    const chunk = (value: string) => [...first, assistant('a2', [step, text(value)])];
    const before = build(chunk('Str'), { isRunning: true }, cache);
    const after = build(chunk('Streaming'), { isRunning: true }, cache);
    const [settled, live] = [...before.turns.keys()] as [string, string];
    expect(after.turns.get(settled)).toBe(before.turns.get(settled));
    expect(after.slices.get('a1')).toBe(before.slices.get('a1'));
    expect(after.turns.get(live)).toBe(before.turns.get(live));
    expect(after.slices.get('a2')!.work[0]).toBe(before.slices.get('a2')!.work[0]);
    expect(after.slices.get('a2')!.answer[0]).not.toBe(before.slices.get('a2')!.answer[0]);
    expect(after.slices.get('a2')!.answer[0]!.key).toBe(before.slices.get('a2')!.answer[0]!.key);
  });
});
