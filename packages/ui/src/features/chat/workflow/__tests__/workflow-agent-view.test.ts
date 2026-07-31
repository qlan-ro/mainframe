/**
 * Behavior tests for the agent-level workflow view-model (`../workflow-agent-view`).
 * Fixed run/agent fixtures, hardcoded expected values — nothing here recomputes the
 * module's own neutralization or precedence rules.
 *
 * Contract pinned by these tests (documented once here, not re-derived):
 *  - neutralizeStaleAgents(run, now): on any terminal run status (completed, failed,
 *    stopped, unavailable), every agent last seen `start`/`progress` becomes
 *    `state: 'unknown'` and gains a `staleNote` string; `done`/`error` agents pass
 *    through untouched; a `running` run returns agents unchanged. Observed tokens and
 *    duration survive neutralization verbatim (D14, AC 16, AC 18, A9).
 *  - staleNote(run, agent, now): "Last observed Ns before the run stopped" for a
 *    stopped run, "Last observed Ns before the run ended" for every other terminal
 *    status (AC 18's words, verbatim; A9). N is the whole-second gap between the
 *    agent's `lastProgressAt` and the run's `terminalAt` (falling back to `now` when
 *    `terminalAt` is absent).
 *  - agentDetailLine(agent, run): exactly one line by precedence — a neutralized
 *    agent's `staleNote`, then `error`, then `resultPreview`, then
 *    `lastToolName · lastToolSummary`, then null (AC 11).
 */
import { describe, it, expect } from 'vitest';
import type { ClaudeWorkflowAgent, ClaudeWorkflowRun, ClaudeWorkflowRunStatus } from '@qlan-ro/mainframe-types';
import { agentDetailLine, neutralizeStaleAgents, staleNote, type ViewAgent } from '../workflow-agent-view';

const NOW = 500_000;

function agent(overrides: Partial<ClaudeWorkflowAgent> = {}): ClaudeWorkflowAgent {
  return {
    agentId: 'agent-1',
    index: 0,
    phaseIndex: 0,
    label: 'reviewer',
    state: 'progress',
    tokens: 222,
    toolCalls: 3,
    durationMs: 5_555,
    ...overrides,
  };
}

function run(overrides: Partial<ClaudeWorkflowRun> = {}): ClaudeWorkflowRun {
  return {
    taskId: 'task-1',
    status: 'running',
    source: 'snapshot',
    totalTokens: 0,
    durationMs: 0,
    phases: [],
    agents: [],
    ...overrides,
  };
}

describe('neutralizeStaleAgents', () => {
  const terminalStatuses: ClaudeWorkflowRunStatus[] = ['completed', 'failed', 'stopped', 'unavailable'];

  for (const status of terminalStatuses) {
    it(`neutralizes a 'progress' agent into 'unknown' with a note when the run is ${status}`, () => {
      const r = run({ status, terminalAt: 200_000, agents: [agent({ state: 'progress', lastProgressAt: 190_000 })] });
      const result = neutralizeStaleAgents(r, NOW)[0]!;
      expect(result.state).toBe('unknown');
      expect(result.tokens).toBe(222);
      expect(result.durationMs).toBe(5_555);
      expect(typeof result.staleNote).toBe('string');
    });
  }

  it("neutralizes a 'start' agent the same as a 'progress' agent", () => {
    const r = run({
      status: 'stopped',
      terminalAt: 200_000,
      agents: [agent({ state: 'start', lastProgressAt: 190_000 })],
    });
    const result = neutralizeStaleAgents(r, NOW)[0]!;
    expect(result.state).toBe('unknown');
    expect(result.staleNote).toBeDefined();
  });

  it('leaves a done agent untouched under a terminal status', () => {
    const r = run({ status: 'completed', agents: [agent({ state: 'done', tokens: 50, durationMs: 1_000 })] });
    const result = neutralizeStaleAgents(r, NOW)[0]!;
    expect(result).toEqual({ ...agent({ state: 'done', tokens: 50, durationMs: 1_000 }), staleNote: undefined });
  });

  it('leaves an error agent untouched under a terminal status', () => {
    const r = run({ status: 'failed', agents: [agent({ state: 'error', error: 'boom' })] });
    const result = neutralizeStaleAgents(r, NOW)[0]!;
    expect(result).toEqual({ ...agent({ state: 'error', error: 'boom' }), staleNote: undefined });
  });

  it('neutralizes nothing while the run is running', () => {
    const r = run({
      status: 'running',
      agents: [agent({ state: 'progress' }), agent({ agentId: 'a-2', state: 'start' })],
    });
    const result = neutralizeStaleAgents(r, NOW);
    expect(result).toEqual([
      { ...agent({ state: 'progress' }), staleNote: undefined },
      { ...agent({ agentId: 'a-2', state: 'start' }), staleNote: undefined },
    ]);
  });

  it('produces the exact "before the run stopped" note for a stopped run', () => {
    const r = run({
      status: 'stopped',
      terminalAt: 200_000,
      agents: [agent({ state: 'progress', lastProgressAt: 190_000 })],
    });
    const result = neutralizeStaleAgents(r, NOW)[0]!;
    expect(result.staleNote).toBe('Last observed 10s before the run stopped');
  });

  it('produces the exact "before the run ended" note for a completed run whose agent is still progress (AC 16)', () => {
    const r = run({
      status: 'completed',
      terminalAt: 200_000,
      agents: [agent({ state: 'progress', lastProgressAt: 190_000 })],
    });
    const result = neutralizeStaleAgents(r, NOW)[0]!;
    expect(result.staleNote).toBe('Last observed 10s before the run ended');
  });

  it('produces the exact "before the run ended" note for a failed run whose agent is still progress (AC 16)', () => {
    const r = run({
      status: 'failed',
      terminalAt: 200_000,
      agents: [agent({ state: 'progress', lastProgressAt: 190_000 })],
    });
    const result = neutralizeStaleAgents(r, NOW)[0]!;
    expect(result.staleNote).toBe('Last observed 10s before the run ended');
  });
});

describe('staleNote', () => {
  it('reads "before the run stopped" for a stopped run', () => {
    const r = run({ status: 'stopped', terminalAt: 200_000 });
    expect(staleNote(r, agent({ lastProgressAt: 188_000 }), NOW)).toBe('Last observed 12s before the run stopped');
  });

  it('reads "before the run ended" for a completed run', () => {
    const r = run({ status: 'completed', terminalAt: 200_000 });
    expect(staleNote(r, agent({ lastProgressAt: 188_000 }), NOW)).toBe('Last observed 12s before the run ended');
  });

  it('falls back to "now" as the reference point when the run has no terminalAt', () => {
    const r = run({ status: 'stopped' });
    expect(staleNote(r, agent({ lastProgressAt: 494_000 }), NOW)).toBe('Last observed 6s before the run stopped');
  });
});

describe('agentDetailLine', () => {
  function viewAgent(overrides: Partial<ViewAgent> = {}): ViewAgent {
    return { ...agent(), ...overrides };
  }

  it('ranks a neutralized staleNote first, above error, resultPreview and last tool', () => {
    const a = viewAgent({
      staleNote: 'Last observed 10s before the run stopped',
      error: 'boom',
      resultPreview: 'preview text',
      lastToolName: 'Edit',
      lastToolSummary: 'src/foo.ts',
    });
    expect(agentDetailLine(a, run({ status: 'stopped' }))).toBe('Last observed 10s before the run stopped');
  });

  it('ranks error second, above resultPreview and last tool', () => {
    const a = viewAgent({
      state: 'error',
      error: 'workflow script exited 1',
      resultPreview: 'preview text',
      lastToolName: 'Edit',
      lastToolSummary: 'src/foo.ts',
    });
    expect(agentDetailLine(a, run())).toBe('workflow script exited 1');
  });

  it('ranks resultPreview third, above last tool', () => {
    const a = viewAgent({
      state: 'done',
      resultPreview: 'Reviewed 3 files, no issues found',
      lastToolName: 'Edit',
      lastToolSummary: 'src/foo.ts',
    });
    expect(agentDetailLine(a, run())).toBe('Reviewed 3 files, no issues found');
  });

  it('joins last tool name and summary when nothing else ranks higher', () => {
    const a = viewAgent({ state: 'progress', lastToolName: 'Edit', lastToolSummary: 'src/foo.ts' });
    expect(agentDetailLine(a, run())).toBe('Edit · src/foo.ts');
  });

  it('returns null when the agent carries no detail at all', () => {
    const a = viewAgent({ state: 'done' });
    expect(agentDetailLine(a, run())).toBeNull();
  });
});
