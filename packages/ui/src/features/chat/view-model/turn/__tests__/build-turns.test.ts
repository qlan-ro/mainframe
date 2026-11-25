import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import { buildTurns } from '../build-turns';
import { TurnCache } from '../turn-cache';
import type { TurnModel, TurnScope, TurnUnit } from '../types';
import { assistant, bash, call, presented, scope, sources, system, text, thought, user } from './fixtures';

const timed = (totalStreamTime: number, mainframe: object) => ({
  metadata: {
    custom: { mainframe },
    timing: { streamStartTime: 0, totalStreamTime, totalChunks: 0, toolCallCount: 0 },
  },
});

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

describe('how long a turn took', () => {
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

describe('a different call is no retry', () => {
  const fail = { isError: true } as const;
  it.each([
    [
      'another edit of the same file',
      call('Edit', { file_path: 'a', old_string: 'x', new_string: 'y' }, { ...fail, toolCallId: 'bad' }),
      call('Edit', { file_path: 'a', old_string: 'p', new_string: 'q' }),
    ],
    [
      'another workflow, which names none',
      call('Workflow', { script: 'one' }, { ...fail, toolCallId: 'bad' }),
      call('Workflow', { script: 'two' }),
    ],
    ['a workflow with no arguments', call('Workflow', {}, { ...fail, toolCallId: 'bad' }), call('Workflow', {})],
    [
      'another part of the same file',
      call('Read', { file_path: 'a', offset: 1 }, { ...fail, toolCallId: 'bad' }),
      call('Read', { file_path: 'a', offset: 900 }),
    ],
    [
      'other content for the same file',
      call('Write', { file_path: 'a', content: 'x' }, { ...fail, toolCallId: 'bad' }),
      call('Write', { file_path: 'a', content: 'y' }),
    ],
  ])('%s', (_name, bad, good) => {
    const turn = only(build([user('u1'), assistant('a1', [bad, good, text('ok')])]));
    expect(turn.failed).toEqual(['bad']);
    expect(turn.retried).toEqual([]);
  });

  it.each([
    [
      'a command that only started in the background',
      bash('', { args: { command: 'vitest' }, ...fail, toolCallId: 'bad' }),
      bash('', {
        args: { command: 'vitest', run_in_background: true },
        result: 'Command running in background with ID: b1',
      }),
    ],
    [
      'a command the CLI moved to the background by itself',
      bash('vitest', { ...fail, toolCallId: 'bad' }),
      bash('vitest', { result: 'Command did not complete within 120s and was moved to the background' }),
    ],
    [
      'an agent that only started in the background',
      call('Task', { prompt: 'x' }, { ...fail, toolCallId: 'bad' }),
      call('Task', { prompt: 'x' }, { result: 'Async agent launched successfully.' }),
    ],
    [
      'an MCP call with another description',
      call('mcp__jira__create', { title: 'x', description: 'a' }, { ...fail, toolCallId: 'bad' }),
      call('mcp__jira__create', { title: 'x', description: 'b' }),
    ],
    [
      'an MCP call with another timeout',
      call('mcp__db__query', { sql: 'x', timeout: 1 }, { ...fail, toolCallId: 'bad' }),
      call('mcp__db__query', { sql: 'x', timeout: 60 }),
    ],
    [
      'an unknown call with another description',
      call('Publish', { description: 'a' }, { ...fail, toolCallId: 'bad' }),
      call('Publish', { description: 'b' }),
    ],
    [
      'an unknown call with another timeout',
      call('Wait', { for: 'x', timeout: 1 }, { ...fail, toolCallId: 'bad' }),
      call('Wait', { for: 'x', timeout: 2 }),
    ],
  ])('%s does not', (_name, bad, good) => {
    const turn = only(build([user('u1'), assistant('a1', [bad, good, text('ok')])]));
    expect([turn.failed, turn.retried]).toEqual([['bad'], []]);
  });
  it.each([
    ['in the foreground, after a launch that failed', { run_in_background: true }, {}],
    ['with another timeout', { timeout: 1 }, { timeout: 60_000 }],
  ])('the same command %s is', (_name, first, then) => {
    const bad = bash('', { args: { command: 'vitest', ...first }, ...fail, toolCallId: 'bad' });
    const good = bash('', { args: { command: 'vitest', ...then } });
    expect(only(build([user('u1'), assistant('a1', [bad, good])])).retried).toEqual(['bad']);
  });
  it('the same edit again is, whatever order its arguments came in', () => {
    const bad = call('Edit', { file_path: 'a', old_string: 'x', new_string: 'y' }, { ...fail, toolCallId: 'bad' });
    const good = call('Edit', { new_string: 'y', file_path: 'a', old_string: 'x' });
    expect(only(build([user('u1'), assistant('a1', [bad, good])])).retried).toEqual(['bad']);
  });
  it('the same command with another description is', () => {
    const bad = bash('', { args: { command: 'vitest', description: 'Test' }, ...fail, toolCallId: 'bad' });
    const good = bash('', { args: { command: 'vitest', description: 'Test again' } });
    expect(only(build([user('u1'), assistant('a1', [bad, good])])).retried).toEqual(['bad']);
  });
});

describe('a call with no outcome', () => {
  const going = { result: undefined, providerMetadata: { mainframe: { acpStatus: 'in_progress' } } };
  const agent = call('Task', { description: 'x' }, { ...going, toolCallId: 'agent' });

  it('runs while its turn does', () => {
    const turn = only(build([user('u1'), assistant('a1', [agent])], { isRunning: true }));
    expect(turn).toMatchObject({ running: true, live: true });
    expect(turn.children[0]!.status).toBe('running');
  });

  it('is stopped once the session was killed', () => {
    const turn = only(build([user('u1'), assistant('a1', [agent])]));
    expect(turn).toMatchObject({ running: false, live: false });
    expect(turn.children[0]!.status).toBe('stopped');
  });

  it('is stopped in an earlier turn without live step evidence', () => {
    const thread = (custom?: object) => [
      user('u1'),
      assistant('a1', [agent], custom),
      user('u2'),
      assistant('a2', [text('Hi')]),
    ];
    const live = (custom?: object) =>
      [...build(thread(custom), { isRunning: true }).turns.values()].map((turn) => turn.live);
    expect(live({ partSources: sources(1, presented({ state: 'cancelled' })) })).toEqual([false, true]);
    expect(live()).toEqual([false, true]);
  });

  it('still runs when the viewer wrote into the turn that goes on', () => {
    const same = (count: number) => ({ partSources: sources(count, presented({ state: 'running' })) });
    const steered = [user('u1'), assistant('a1', [agent], same(1)), user('u2')];
    expect(only(build(steered, { isRunning: true })).live).toBe(true);
    const went = build([...steered, assistant('a2', [text('Sure')], same(1))], { isRunning: true });
    expect([...went.turns.values()].map(({ running, live }) => [running, live])).toEqual([
      [false, true],
      [true, true],
    ]);
  });
});

describe('a turn that waits on the viewer', () => {
  const pendingWrite = call(
    'Write',
    { file_path: 'a', content: 'x' },
    { toolCallId: 'w', result: undefined, providerMetadata: { mainframe: { acpStatus: 'in_progress' } } },
  );
  const asked = [user('u1'), assistant('a1', [text('I will write it'), pendingWrite])];

  it('has not ended, though the thread reports itself idle', () => {
    const turn = only(build(asked, { pendingToolIds: new Set(['w']) }));
    expect(turn).toMatchObject({ running: true, needsYou: true, live: true });
  });

  it('keeps its words among the steps: there is no answer yet', () => {
    const model = build(asked, { pendingToolIds: new Set(['w']) });
    expect(roles(model, 'a1')).toEqual({ work: ['I will write it', 'Write'], markers: [], answer: [] });
  });

  it.each([
    ['is the turn that runs while the call itself has not arrived', true, [false, true]],
    // A background agent's request, whose call is in the history that isn't loaded.
    ['is no turn when nothing runs: the newest one has finished', false, [false, false]],
  ])('%s', (_name, isRunning, needsYou) => {
    const model = build([user('u1'), assistant('a1', [text('A')]), user('u2'), assistant('a2', [text('B')])], {
      pendingToolIds: new Set(['not-here']),
      isRunning,
    });
    expect([...model.turns.values()].map((turn) => turn.needsYou)).toEqual(needsYou);
  });

  it('is not the newest turn when the request is a background agent’s of an earlier one', () => {
    const agent = call('Task', {}, { messages: [assistant('n', [{ ...pendingWrite }])] as never });
    const model = build([user('u1'), assistant('a1', [agent]), user('u2'), assistant('a2', [text('B')])], {
      pendingToolIds: new Set(['w']),
    });
    expect([...model.turns.values()].map(({ running, needsYou }) => [running, needsYou])).toEqual([
      [false, false],
      [false, false],
    ]);
    expect([...model.turns.values()][0]!.children[0]!.status).toBe('awaiting-approval');
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
      // In a turn that ended, a call with no outcome was cut short.
      { toolCallId: 'task', kind: 'agent', status: 'stopped' },
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
    expect(model.absorbedBy.get('s1')).toEqual(['skill']);
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
    expect(model.taskResults.get('t1')).toBe('completed');
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

describe('what the footer reads', () => {
  it('takes the cost and the end of the turn from whichever message has them', () => {
    const turn = only(
      build([
        user('u1'),
        assistant('a1', [text('Done')], { cost: 0.25 }),
        assistant('a2', [bash('git status')], {}, timed(2000, { cost: 0.5 })),
      ]),
    );
    expect(turn).toMatchObject({ costUsd: 0.75, durationMs: 2000, lastMessageId: 'a2' });
  });
});

describe('a turn’s standing is part of what its rows read', () => {
  const going = { result: undefined, providerMetadata: { mainframe: { acpStatus: 'in_progress' } } };
  const codex = presented({ provider: 'codex', state: 'running' });

  it('changes when the run ends, though nothing else of the turn does', () => {
    const cache = new TurnCache();
    // Its only step is a marker, so neither its summary nor its children say anything.
    const messages = [
      user('u1'),
      assistant('a1', [call('Monitor', {}, going), text('Watching')], { partSources: sources(2, codex) }),
      user('u2'),
    ];
    const at = (isRunning: boolean) => only(build(messages, { isRunning, runAfter: null }, cache));
    expect(at(true).live).toBe(true);
    expect(at(false).live).toBe(false);
  });

  it('changes when the request turns out to be another turn’s', () => {
    const cache = new TurnCache();
    const agent = (messages: ThreadMessage[]) =>
      call('Task', {}, { toolCallId: 'agent', messages, result: 'Async agent launched successfully.' } as never);
    const latest = [user('u2'), assistant('a2', [call('ExitPlanMode', {}, going)])];
    const thread = (nested: ThreadMessage[]) => [user('u1'), assistant('a1', [agent(nested)]), ...latest];
    const options = { isRunning: true, pendingToolIds: new Set(['write']) };
    const needsYou = (nested: ThreadMessage[]) =>
      [...build(thread(nested), options, cache).turns.values()].map((turn) => turn.needsYou);
    expect(needsYou([])).toEqual([false, true]);
    // The request turns out to be the background agent's.
    expect(needsYou([assistant('n', [call('Write', {}, { ...going, toolCallId: 'write' })])])).toEqual([false, false]);
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
