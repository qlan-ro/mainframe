/**
 * Behavior tests for the run-level workflow view-model (`../workflow-progress`).
 * Fixed run fixtures, hardcoded expected strings/values — nothing here
 * recomputes the module's own formatting rules.
 *
 * Contract pinned by these tests (documented once here, not re-derived):
 *  - runMetaString joins with ' · ': "N agent(s)", "N failed" (only if >0),
 *    "N unknown" (only if >0), "running" (only while live), run tokens,
 *    run duration. No phase title (D18).
 *  - formatRunTokens: <1000 → "N tok"; else → "X.Xk tok".
 *  - formatRunDuration: <1 minute → "<1m"; <60 minutes → "Nm"; else "NhMm".
 *  - outcomeDot: {tone,pulse} — green/no-pulse on a clean completion, amber/no-pulse
 *    on a completion with a failed agent, red/no-pulse on failed, amber/pulse while
 *    running, hollow/no-pulse for stopped, paused and unavailable.
 *  - statusChipLabel: exactly one of Running|Completed|Failed|Stopped|Paused|Unavailable.
 *  - summarizeRun: "Phase <index> · <title> — X of Y done[, N running][, N failed][, N unknown]",
 *    naming the deepest phase (highest phaseIndex) that has spawned an agent; when no
 *    agent has spawned, only the "X of Y done" clause renders.
 */
import { describe, it, expect } from 'vitest';
import type { ClaudeWorkflowAgent, ClaudeWorkflowPhase, ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import {
  formatRunDuration,
  formatRunTokens,
  outcomeDot,
  parseWorkflowLaunch,
  runMetaString,
  statusChipLabel,
  summarizeRun,
} from '../workflow-progress';

const NOW = 100_000;

function agent(overrides: Partial<ClaudeWorkflowAgent> = {}): ClaudeWorkflowAgent {
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

function phase(overrides: Partial<ClaudeWorkflowPhase> = {}): ClaudeWorkflowPhase {
  return { index: 0, title: 'Review', ...overrides };
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

describe('parseWorkflowLaunch', () => {
  it('extracts taskId, runId and workflowName from an async_launched result', () => {
    const result = JSON.stringify({
      status: 'async_launched',
      taskId: 'task-9',
      runId: 'run_9',
      workflowName: 'deploy',
    });
    expect(parseWorkflowLaunch(result)).toEqual({ taskId: 'task-9', runId: 'run_9', workflowName: 'deploy' });
  });

  it('accepts an already-parsed object, not only a JSON string', () => {
    const result = { status: 'async_launched', taskId: 'task-9', runId: 'run_9' };
    expect(parseWorkflowLaunch(result)).toEqual({ taskId: 'task-9', runId: 'run_9', workflowName: undefined });
  });

  it('returns { error } for a result carrying an error and no run id', () => {
    const result = JSON.stringify({ error: 'workflow script not found' });
    expect(parseWorkflowLaunch(result)).toEqual({ error: 'workflow script not found' });
  });

  it('returns {} for junk text', () => {
    expect(parseWorkflowLaunch('not json at all')).toEqual({});
  });

  it('returns {} for an object with neither a runId nor an error', () => {
    expect(parseWorkflowLaunch({ status: 'ok' })).toEqual({});
  });

  it('returns {} for undefined (no result yet)', () => {
    expect(parseWorkflowLaunch(undefined)).toEqual({});
  });
});

describe('formatRunTokens', () => {
  it('renders sub-1000 counts verbatim', () => {
    expect(formatRunTokens(0)).toBe('0 tok');
    expect(formatRunTokens(842)).toBe('842 tok');
  });

  it('renders 1000+ counts as one-decimal k', () => {
    expect(formatRunTokens(1_000)).toBe('1.0k tok');
    expect(formatRunTokens(12_345)).toBe('12.3k tok');
  });
});

describe('formatRunDuration', () => {
  it('renders sub-minute durations as "<1m"', () => {
    expect(formatRunDuration(0)).toBe('<1m');
    expect(formatRunDuration(45_000)).toBe('<1m');
  });

  it('renders minute-only durations as "Nm"', () => {
    expect(formatRunDuration(5 * 60_000)).toBe('5m');
  });

  it('renders hour-plus durations as "NhMm"', () => {
    expect(formatRunDuration(72 * 60_000)).toBe('1h 12m');
  });
});

describe('outcomeDot', () => {
  it('reads green with no pulse on a clean completion', () => {
    const r = run({ status: 'completed', agents: [agent({ state: 'done' })] });
    expect(outcomeDot(r, NOW)).toEqual({ tone: 'green', pulse: false });
  });

  it('reads amber with no pulse on a completion with a failed agent', () => {
    const r = run({
      status: 'completed',
      agents: [agent({ state: 'done' }), agent({ agentId: 'a-2', state: 'error' })],
    });
    expect(outcomeDot(r, NOW)).toEqual({ tone: 'amber', pulse: false });
  });

  it('reads red with no pulse on a failed run', () => {
    const r = run({ status: 'failed' });
    expect(outcomeDot(r, NOW)).toEqual({ tone: 'red', pulse: false });
  });

  it('reads pulsing amber while running', () => {
    const r = run({ status: 'running' });
    expect(outcomeDot(r, NOW)).toEqual({ tone: 'amber', pulse: true });
  });

  it('reads hollow with no pulse when stopped', () => {
    expect(outcomeDot(run({ status: 'stopped' }), NOW)).toEqual({ tone: 'hollow', pulse: false });
  });

  it('reads hollow with no pulse when paused', () => {
    expect(outcomeDot(run({ status: 'paused' }), NOW)).toEqual({ tone: 'hollow', pulse: false });
  });

  it('reads hollow with no pulse when unavailable', () => {
    expect(outcomeDot(run({ status: 'unavailable' }), NOW)).toEqual({ tone: 'hollow', pulse: false });
  });
});

describe('statusChipLabel', () => {
  it('maps every status to its exact label', () => {
    expect(statusChipLabel('running')).toBe('Running');
    expect(statusChipLabel('completed')).toBe('Completed');
    expect(statusChipLabel('failed')).toBe('Failed');
    expect(statusChipLabel('stopped')).toBe('Stopped');
    expect(statusChipLabel('paused')).toBe('Paused');
    expect(statusChipLabel('unavailable')).toBe('Unavailable');
  });
});

describe('runMetaString', () => {
  it('joins agent count, tokens and duration when nothing failed, unknown or running', () => {
    const r = run({
      status: 'completed',
      totalTokens: 500,
      durationMs: 90_000,
      agents: [agent({ state: 'done' }), agent({ agentId: 'a-2', state: 'done' })],
    });
    expect(runMetaString(r, NOW)).toBe('2 agents · 500 tok · 1m');
  });

  it('uses the singular "agent" for exactly one agent', () => {
    const r = run({ status: 'completed', totalTokens: 10, durationMs: 0, agents: [agent()] });
    expect(runMetaString(r, NOW)).toBe('1 agent · 10 tok · <1m');
  });

  it('includes the failed count only when non-zero', () => {
    const r = run({
      status: 'completed',
      totalTokens: 10,
      durationMs: 0,
      agents: [agent({ state: 'done' }), agent({ agentId: 'a-2', state: 'error' })],
    });
    expect(runMetaString(r, NOW)).toBe('2 agents · 1 failed · 10 tok · <1m');
  });

  it('includes the unknown count only when non-zero', () => {
    const r = run({
      status: 'stopped',
      totalTokens: 10,
      durationMs: 0,
      agents: [agent({ state: 'done' }), agent({ agentId: 'a-2', state: 'unknown' })],
    });
    expect(runMetaString(r, NOW)).toBe('2 agents · 1 unknown · 10 tok · <1m');
  });

  it('includes "running" only while the run is live', () => {
    const r = run({ status: 'running', totalTokens: 10, durationMs: 0, agents: [agent({ state: 'progress' })] });
    expect(runMetaString(r, NOW)).toBe('1 agent · running · 10 tok · <1m');
  });

  it('joins every clause when all are present', () => {
    const r = run({
      status: 'running',
      totalTokens: 12_345,
      durationMs: 72 * 60_000,
      agents: [
        agent({ agentId: 'a-1', state: 'error' }),
        agent({ agentId: 'a-2', state: 'unknown' }),
        agent({ agentId: 'a-3', state: 'progress' }),
      ],
    });
    expect(runMetaString(r, NOW)).toBe('3 agents · 1 failed · 1 unknown · running · 12.3k tok · 1h 12m');
  });
});

describe('summarizeRun', () => {
  it('names the deepest phase that has spawned an agent, with zero counts omitted', () => {
    const r = run({
      status: 'running',
      phases: [phase({ index: 0, title: 'Plan' }), phase({ index: 1, title: 'Build' })],
      agents: [
        agent({ agentId: 'a-1', phaseIndex: 0, state: 'done' }),
        agent({ agentId: 'a-2', phaseIndex: 1, state: 'progress' }),
      ],
    });
    expect(summarizeRun(r, NOW)).toBe('Phase 1 · Build — 1 of 2 done, 1 running');
  });

  it('names the later phase even when the only unfinished agent errored earlier (AC 8)', () => {
    const r = run({
      status: 'running',
      phases: [phase({ index: 0, title: 'Plan' }), phase({ index: 1, title: 'Build' })],
      agents: [
        agent({ agentId: 'a-1', phaseIndex: 0, state: 'error' }),
        agent({ agentId: 'a-2', phaseIndex: 1, state: 'done' }),
      ],
    });
    expect(summarizeRun(r, NOW)).toBe('Phase 1 · Build — 1 of 2 done, 1 failed');
  });

  it('shows only the done clause when no agent has spawned yet', () => {
    const r = run({
      status: 'running',
      phases: [phase({ index: 0, title: 'Plan' })],
      agents: [],
    });
    expect(summarizeRun(r, NOW)).toBe('0 of 0 done');
  });

  it('reports all four counts when every kind is present', () => {
    const r = run({
      status: 'stopped',
      phases: [phase({ index: 0, title: 'Plan' })],
      agents: [
        agent({ agentId: 'a-1', phaseIndex: 0, state: 'done' }),
        agent({ agentId: 'a-2', phaseIndex: 0, state: 'progress' }),
        agent({ agentId: 'a-3', phaseIndex: 0, state: 'error' }),
        agent({ agentId: 'a-4', phaseIndex: 0, state: 'unknown' }),
      ],
    });
    expect(summarizeRun(r, NOW)).toBe('Phase 0 · Plan — 1 of 4 done, 1 running, 1 failed, 1 unknown');
  });
});
