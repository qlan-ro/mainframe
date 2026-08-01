/**
 * Run-level view-model for a Claude CLI workflow run: launch parsing, formatting,
 * outcome tone and the two summary strings. Pure and React-free.
 *
 * Counts read the agent states exactly as given. Callers that render a terminal run
 * pass a run whose agents were already neutralized (`neutralizedRun` in
 * `workflow-agent-view`), so a lingering `progress` agent is counted as unknown here.
 */
import type { ClaudeWorkflowAgent, ClaudeWorkflowRun, ClaudeWorkflowRunStatus } from '@qlan-ro/mainframe-types';

export interface WorkflowLaunch {
  taskId?: string;
  runId?: string;
  workflowName?: string;
  error?: string;
}

export type OutcomeTone = 'green' | 'amber' | 'red' | 'hollow';

export interface OutcomeDot {
  tone: OutcomeTone;
  pulse: boolean;
}

const STATUS_LABEL: Record<ClaudeWorkflowRunStatus, string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
  paused: 'Paused',
  unavailable: 'Unavailable',
};

const TERMINAL_STATUSES: readonly ClaudeWorkflowRunStatus[] = ['completed', 'failed', 'stopped', 'unavailable'];

export function isTerminalRunStatus(status: ClaudeWorkflowRunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return undefined; /* expected — a tool result is free text until it parses */
    }
  }
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Reads the `Workflow`/`RunWorkflow` tool result: a launched run, a launch failure, or neither. */
export function parseWorkflowLaunch(result: unknown): WorkflowLaunch {
  const record = asRecord(result);
  if (!record) return {};

  const runId = stringField(record, 'runId');
  if (runId) {
    return { taskId: stringField(record, 'taskId'), runId, workflowName: stringField(record, 'workflowName') };
  }

  const error = stringField(record, 'error');
  return error ? { error } : {};
}

/** Stand-in run for a launch whose record the daemon never produced (AC 19). */
export function unavailableRun(launch: WorkflowLaunch): ClaudeWorkflowRun {
  return {
    taskId: launch.taskId ?? launch.runId ?? '',
    runId: launch.runId,
    workflowName: launch.workflowName,
    status: 'unavailable',
    source: 'launch',
    totalTokens: 0,
    durationMs: 0,
    phases: [],
    agents: [],
  };
}

/** Anchor and testid key: the run id once the CLI has reported one, else the task id (A1). */
export function runKey(run: ClaudeWorkflowRun): string {
  return run.runId ?? run.taskId;
}

export function formatRunTokens(tokens: number): string {
  return tokens < 1000 ? `${tokens} tok` : `${(tokens / 1000).toFixed(1)}k tok`;
}

export function formatRunDuration(durationMs: number): string {
  const minutes = Math.floor(Math.max(0, durationMs) / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function statusChipLabel(status: ClaudeWorkflowRunStatus): string {
  return STATUS_LABEL[status];
}

interface AgentCounts {
  total: number;
  done: number;
  running: number;
  failed: number;
  unknown: number;
}

function countAgents(agents: readonly ClaudeWorkflowAgent[]): AgentCounts {
  const counts: AgentCounts = { total: agents.length, done: 0, running: 0, failed: 0, unknown: 0 };
  for (const agent of agents) {
    if (agent.state === 'done') counts.done += 1;
    else if (agent.state === 'error') counts.failed += 1;
    else if (agent.state === 'unknown') counts.unknown += 1;
    else counts.running += 1;
  }
  return counts;
}

/**
 * `now` is the caller's render clock. The run-level strings are clock-independent —
 * every time-dependent reading happens during neutralization — but they take it so the
 * whole view-model family shares one signature and one instant.
 */
export function outcomeDot(run: ClaudeWorkflowRun, _now: number): OutcomeDot {
  switch (run.status) {
    case 'running':
      return { tone: 'amber', pulse: true };
    case 'failed':
      return { tone: 'red', pulse: false };
    case 'completed':
      return { tone: countAgents(run.agents).failed > 0 ? 'amber' : 'green', pulse: false };
    default:
      return { tone: 'hollow', pulse: false };
  }
}

/** The one-line launcher/list meta: agent count, exceptions, liveness, tokens, duration (D18). */
export function runMetaString(run: ClaudeWorkflowRun, _now: number): string {
  const counts = countAgents(run.agents);
  const parts = [`${counts.total} ${counts.total === 1 ? 'agent' : 'agents'}`];
  if (counts.failed > 0) parts.push(`${counts.failed} failed`);
  if (counts.unknown > 0) parts.push(`${counts.unknown} unknown`);
  if (run.status === 'running') parts.push('running');
  parts.push(formatRunTokens(run.totalTokens), formatRunDuration(run.durationMs));
  return parts.join(' · ');
}

function deepestSpawnedPhase(run: ClaudeWorkflowRun) {
  if (run.agents.length === 0) return undefined;
  const deepest = Math.max(...run.agents.map((agent) => agent.phaseIndex));
  return run.phases.find((phase) => phase.index === deepest);
}

/** The panel's progress line: how far the run got, named by the deepest phase that spawned an agent. */
export function summarizeRun(run: ClaudeWorkflowRun, _now: number): string {
  const counts = countAgents(run.agents);
  const clauses = [`${counts.done} of ${counts.total} done`];
  if (counts.running > 0) clauses.push(`${counts.running} running`);
  if (counts.failed > 0) clauses.push(`${counts.failed} failed`);
  if (counts.unknown > 0) clauses.push(`${counts.unknown} unknown`);

  const phase = deepestSpawnedPhase(run);
  const progress = clauses.join(', ');
  return phase ? `Phase ${phase.index} · ${phase.title} — ${progress}` : progress;
}
