/**
 * Behavior tests for the phase-level workflow view-model (`../workflow-phase-view`).
 * Fixed run/phase/agent fixtures, hardcoded expected values — nothing here recomputes
 * the module's own status derivation, duration folding or timeline split.
 *
 * Contract pinned by these tests (documented once here, not re-derived):
 *  - agentPipStatus(agent): done → 'done', error → 'failed', unknown → 'unknown',
 *    start/progress → 'running'.
 *  - runTimeline(run).all: one view per seeded phase, in CLI order. A phase's status
 *    comes from its agents — none → 'pending'; any start/progress → 'running'; else any
 *    error → 'failed'; else any done → 'done'; else 'unknown'. Its durationMs is the
 *    LONGEST agent duration, not the sum: a phase's agents run concurrently.
 *  - The timeline split: `shown` is every phase up to the deepest agent-bearing one
 *    (an agent-less phase between two active ones stays in `shown`, as pending);
 *    `upNext` is the trailing phases nothing has reached; `orphans` are agents whose
 *    phaseIndex was never seeded — they are surfaced, never dropped.
 *  - Anti-flicker: while the run is `running`, the deepest agent-bearing phase reads
 *    'running' even when all of its agents are done (the script is still between
 *    waves). Under any other run status that phase reads 'done'.
 *  - currentPhase(timeline): the deepest running phase, else the first failed one,
 *    else undefined.
 *  - donePhaseCount(timeline): how many of `all` read exactly 'done'.
 */
import { describe, it, expect } from 'vitest';
import type { ClaudeWorkflowPhase } from '@qlan-ro/mainframe-types';
import type { ViewAgent, ViewRun } from '../workflow-agent-view';
import { agentPipStatus, currentPhase, donePhaseCount, runTimeline } from '../workflow-phase-view';

function agent(overrides: Partial<ViewAgent> = {}): ViewAgent {
  return {
    agentId: 'agent-1',
    index: 0,
    phaseIndex: 0,
    label: 'reviewer',
    state: 'done',
    tokens: 100,
    toolCalls: 2,
    durationMs: 5_000,
    ...overrides,
  };
}

function phase(index: number, title: string): ClaudeWorkflowPhase {
  return { index, title };
}

function run(overrides: Partial<ViewRun> = {}): ViewRun {
  return {
    taskId: 'task-1',
    runId: 'run_1',
    workflowName: 'deploy',
    status: 'running',
    source: 'snapshot',
    totalTokens: 0,
    durationMs: 0,
    phases: [],
    agents: [],
    ...overrides,
  };
}

describe('agentPipStatus', () => {
  it("reads a done agent as 'done'", () => {
    expect(agentPipStatus(agent({ state: 'done' }))).toBe('done');
  });

  it("reads an error agent as 'failed'", () => {
    expect(agentPipStatus(agent({ state: 'error' }))).toBe('failed');
  });

  it("reads a neutralized agent as 'unknown'", () => {
    expect(agentPipStatus(agent({ state: 'unknown' }))).toBe('unknown');
  });

  it("reads a just-started agent as 'running'", () => {
    expect(agentPipStatus(agent({ state: 'start' }))).toBe('running');
  });

  it("reads a mid-flight agent as 'running'", () => {
    expect(agentPipStatus(agent({ state: 'progress' }))).toBe('running');
  });
});

describe('runTimeline — phase status', () => {
  it("reads a phase with no agents as 'pending'", () => {
    const timeline = runTimeline(run({ phases: [phase(0, 'Plan')], agents: [] }));
    expect(timeline.all[0]!.status).toBe('pending');
  });

  it("reads a phase holding any live agent as 'running', even next to a failure", () => {
    const timeline = runTimeline(
      run({
        phases: [phase(0, 'Plan')],
        agents: [
          agent({ agentId: 'a-1', state: 'error' }),
          agent({ agentId: 'a-2', state: 'done' }),
          agent({ agentId: 'a-3', state: 'progress' }),
        ],
      }),
    );
    expect(timeline.all[0]!.status).toBe('running');
  });

  it("reads a phase with a failure and no live agent as 'failed'", () => {
    const timeline = runTimeline(
      run({
        status: 'failed',
        phases: [phase(0, 'Plan')],
        agents: [agent({ agentId: 'a-1', state: 'done' }), agent({ agentId: 'a-2', state: 'error' })],
      }),
    );
    expect(timeline.all[0]!.status).toBe('failed');
  });

  it("reads a phase whose agents all finished as 'done'", () => {
    const timeline = runTimeline(
      run({
        status: 'completed',
        phases: [phase(0, 'Plan')],
        agents: [agent({ agentId: 'a-1', state: 'done' }), agent({ agentId: 'a-2', state: 'done' })],
      }),
    );
    expect(timeline.all[0]!.status).toBe('done');
  });

  it("reads a phase of only neutralized agents as 'unknown'", () => {
    const timeline = runTimeline(
      run({
        status: 'stopped',
        phases: [phase(0, 'Plan')],
        agents: [agent({ agentId: 'a-1', state: 'unknown' }), agent({ agentId: 'a-2', state: 'unknown' })],
      }),
    );
    expect(timeline.all[0]!.status).toBe('unknown');
  });
});

describe('runTimeline — phase duration', () => {
  it('takes the longest agent duration, not the sum — the agents ran in parallel', () => {
    const timeline = runTimeline(
      run({
        status: 'completed',
        phases: [phase(0, 'Plan')],
        agents: [
          agent({ agentId: 'a-1', state: 'done', durationMs: 3_000 }),
          agent({ agentId: 'a-2', state: 'done', durationMs: 9_000 }),
        ],
      }),
    );
    expect(timeline.all[0]!.durationMs).toBe(9_000);
  });

  it('reads 0 for a phase that has spawned nothing', () => {
    const timeline = runTimeline(run({ phases: [phase(0, 'Plan')], agents: [] }));
    expect(timeline.all[0]!.durationMs).toBe(0);
  });
});

describe('runTimeline — the shown/upNext split', () => {
  const fixture = run({
    status: 'running',
    phases: [phase(0, 'Plan'), phase(1, 'Wait'), phase(2, 'Build'), phase(3, 'Review'), phase(4, 'QA')],
    agents: [
      agent({ agentId: 'a-1', phaseIndex: 0, state: 'done' }),
      agent({ agentId: 'a-2', phaseIndex: 2, state: 'progress' }),
    ],
  });

  it('charts every seeded phase in `all`, whatever the split', () => {
    expect(runTimeline(fixture).all.map((view) => view.phase.title)).toEqual(['Plan', 'Wait', 'Build', 'Review', 'QA']);
  });

  it('shows every phase up to the deepest one that has spawned agents', () => {
    expect(runTimeline(fixture).shown.map((view) => view.phase.title)).toEqual(['Plan', 'Wait', 'Build']);
  });

  it('keeps an agent-less phase BETWEEN two active ones in the timeline, as pending', () => {
    const shown = runTimeline(fixture).shown;
    expect(shown.map((view) => view.status)).toEqual(['done', 'pending', 'running']);
  });

  it('collapses only the trailing phases into upNext', () => {
    expect(runTimeline(fixture).upNext).toEqual([phase(3, 'Review'), phase(4, 'QA')]);
  });

  it('shows nothing and queues every phase when no agent has spawned yet', () => {
    const timeline = runTimeline(run({ phases: [phase(0, 'Plan'), phase(1, 'Build'), phase(2, 'QA')], agents: [] }));
    expect(timeline.shown).toEqual([]);
    expect(timeline.upNext).toEqual([phase(0, 'Plan'), phase(1, 'Build'), phase(2, 'QA')]);
  });

  it('shows and queues nothing for a run with no phases at all', () => {
    const timeline = runTimeline(run({ phases: [], agents: [] }));
    expect(timeline.all).toEqual([]);
    expect(timeline.shown).toEqual([]);
    expect(timeline.upNext).toEqual([]);
  });
});

describe('runTimeline — anti-flicker on the deepest phase', () => {
  const phases = [phase(0, 'Plan'), phase(1, 'Build')];
  const agents = [
    agent({ agentId: 'a-1', phaseIndex: 0, state: 'done' }),
    agent({ agentId: 'a-2', phaseIndex: 1, state: 'done' }),
  ];

  it("keeps the deepest phase 'running' while the run is live, even with every agent done", () => {
    const timeline = runTimeline(run({ status: 'running', phases, agents }));
    expect(timeline.all.map((view) => view.status)).toEqual(['done', 'running']);
  });

  it("leaves the deepest phase 'done' once the run has completed", () => {
    const timeline = runTimeline(run({ status: 'completed', phases, agents }));
    expect(timeline.all.map((view) => view.status)).toEqual(['done', 'done']);
  });

  it('keeps the flipped phase out of the done count while the run is live', () => {
    expect(donePhaseCount(runTimeline(run({ status: 'running', phases, agents })))).toBe(1);
    expect(donePhaseCount(runTimeline(run({ status: 'completed', phases, agents })))).toBe(2);
  });
});

describe('runTimeline — orphaned agents', () => {
  it('collects agents whose phaseIndex was never seeded instead of dropping them', () => {
    const timeline = runTimeline(
      run({
        status: 'completed',
        phases: [phase(0, 'Plan')],
        agents: [
          agent({ agentId: 'a-1', phaseIndex: 0, state: 'done' }),
          agent({ agentId: 'a-2', phaseIndex: 7, state: 'done' }),
        ],
      }),
    );
    expect(timeline.orphans.map((a) => a.agentId)).toEqual(['a-2']);
    expect(timeline.all[0]!.agents.map((a) => a.agentId)).toEqual(['a-1']);
  });

  it('treats every agent as an orphan when the run was rebuilt without its phases', () => {
    const timeline = runTimeline(
      run({
        status: 'completed',
        phases: [],
        agents: [agent({ agentId: 'a-1', phaseIndex: 0 }), agent({ agentId: 'a-2', phaseIndex: 1 })],
      }),
    );
    expect(timeline.orphans.map((a) => a.agentId)).toEqual(['a-1', 'a-2']);
  });

  it('reports no orphans when every agent sits in a seeded phase', () => {
    const timeline = runTimeline(
      run({ status: 'completed', phases: [phase(0, 'Plan')], agents: [agent({ agentId: 'a-1', phaseIndex: 0 })] }),
    );
    expect(timeline.orphans).toEqual([]);
  });
});

describe('currentPhase', () => {
  it('names the deepest running phase, above an earlier failure', () => {
    const timeline = runTimeline(
      run({
        status: 'running',
        phases: [phase(0, 'Plan'), phase(1, 'Build')],
        agents: [
          agent({ agentId: 'a-1', phaseIndex: 0, state: 'error' }),
          agent({ agentId: 'a-2', phaseIndex: 1, state: 'progress' }),
        ],
      }),
    );
    expect(currentPhase(timeline)?.phase.title).toBe('Build');
  });

  it('falls back to the first failed phase when nothing is running', () => {
    const timeline = runTimeline(
      run({
        status: 'failed',
        phases: [phase(0, 'Plan'), phase(1, 'Build')],
        agents: [
          agent({ agentId: 'a-1', phaseIndex: 0, state: 'error' }),
          agent({ agentId: 'a-2', phaseIndex: 1, state: 'done' }),
        ],
      }),
    );
    expect(currentPhase(timeline)?.phase.title).toBe('Plan');
  });

  it('names nothing when every phase finished cleanly', () => {
    const timeline = runTimeline(
      run({
        status: 'completed',
        phases: [phase(0, 'Plan'), phase(1, 'Build')],
        agents: [
          agent({ agentId: 'a-1', phaseIndex: 0, state: 'done' }),
          agent({ agentId: 'a-2', phaseIndex: 1, state: 'done' }),
        ],
      }),
    );
    expect(currentPhase(timeline)).toBeUndefined();
  });

  it('names nothing when the run has not reached its first phase', () => {
    const timeline = runTimeline(run({ phases: [phase(0, 'Plan'), phase(1, 'Build')], agents: [] }));
    expect(currentPhase(timeline)).toBeUndefined();
  });
});

describe('donePhaseCount', () => {
  it("counts only the phases reading exactly 'done'", () => {
    const timeline = runTimeline(
      run({
        status: 'completed',
        phases: [phase(0, 'Plan'), phase(1, 'Build'), phase(2, 'Review'), phase(3, 'QA')],
        agents: [
          agent({ agentId: 'a-1', phaseIndex: 0, state: 'done' }),
          agent({ agentId: 'a-2', phaseIndex: 1, state: 'error' }),
          agent({ agentId: 'a-3', phaseIndex: 3, state: 'unknown' }),
        ],
      }),
    );
    expect(timeline.all.map((view) => view.status)).toEqual(['done', 'failed', 'pending', 'unknown']);
    expect(donePhaseCount(timeline)).toBe(1);
  });

  it('counts 0 for a run that has spawned nothing', () => {
    expect(donePhaseCount(runTimeline(run({ phases: [phase(0, 'Plan')], agents: [] })))).toBe(0);
  });
});
