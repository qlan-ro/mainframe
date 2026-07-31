/**
 * Agent-level view-model for a workflow run: stale neutralization plus the row's
 * dot tone, detail line, title and metrics. Pure and React-free.
 *
 * A CLI process can die between an agent's last `progress` event and the run's end,
 * so a terminal run may still carry agents last seen mid-flight. Rather than showing
 * them as live forever, every consumer renders `neutralizedRun`/`neutralizeStaleAgents`
 * output: those agents read `unknown` and carry a note saying when they were last seen
 * (D14, AC 16, AC 18, A9). Their observed tokens and duration survive verbatim.
 */
import type { ClaudeWorkflowAgent, ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { isTerminalRunStatus, type OutcomeTone } from './workflow-progress';

export interface ViewAgent extends ClaudeWorkflowAgent {
  /** Set only on a neutralized agent — the row's first-precedence detail line. */
  staleNote?: string;
}

export interface ViewRun extends ClaudeWorkflowRun {
  agents: ViewAgent[];
}

/** Whole seconds between an agent's last sign of life and the run's end. */
export function staleGapSeconds(run: ClaudeWorkflowRun, agent: ClaudeWorkflowAgent, now: number): number {
  const reference = run.terminalAt ?? now;
  return Math.max(0, Math.round((reference - (agent.lastProgressAt ?? reference)) / 1000));
}

export function staleNote(run: ClaudeWorkflowRun, agent: ClaudeWorkflowAgent, now: number): string {
  const ending = run.status === 'stopped' ? 'stopped' : 'ended';
  return `Last observed ${staleGapSeconds(run, agent, now)}s before the run ${ending}`;
}

export function neutralizeStaleAgents(run: ClaudeWorkflowRun, now: number): ViewAgent[] {
  const terminal = isTerminalRunStatus(run.status);
  return run.agents.map((agent) => {
    const lingering = agent.state === 'start' || agent.state === 'progress';
    if (!terminal || !lingering) return { ...agent, staleNote: undefined };
    return { ...agent, state: 'unknown', staleNote: staleNote(run, agent, now) };
  });
}

export function neutralizedRun(run: ClaudeWorkflowRun, now: number): ViewRun {
  return { ...run, agents: neutralizeStaleAgents(run, now) };
}

export function staleAgents(agents: readonly ViewAgent[]): ViewAgent[] {
  return agents.filter((agent) => agent.staleNote !== undefined);
}

export type DetailKind = 'stale' | 'error' | 'result' | 'tool';

/** Which of the four detail sources wins for this agent — the row inks the line by kind. */
export function agentDetailKind(agent: ViewAgent): DetailKind | null {
  if (agent.staleNote) return 'stale';
  if (agent.error) return 'error';
  if (agent.resultPreview) return 'result';
  if (agent.lastToolName) return 'tool';
  return null;
}

/** The single detail line under an agent's name, by precedence (AC 11). */
export function agentDetailLine(agent: ViewAgent, _run: ClaudeWorkflowRun): string | null {
  switch (agentDetailKind(agent)) {
    case 'stale':
      return agent.staleNote ?? null;
    case 'error':
      return agent.error ?? null;
    case 'result':
      return agent.resultPreview ?? null;
    case 'tool':
      return agent.lastToolSummary ? `${agent.lastToolName} · ${agent.lastToolSummary}` : (agent.lastToolName ?? null);
    default:
      return null;
  }
}

export function agentDotTone(agent: ViewAgent): OutcomeTone {
  switch (agent.state) {
    case 'done':
      return 'green';
    case 'error':
      return 'red';
    case 'unknown':
      return 'hollow';
    default:
      return 'amber';
  }
}

export function agentDotPulse(agent: ViewAgent): boolean {
  return agent.state === 'start' || agent.state === 'progress';
}

/** Secondary facts kept off the row itself (D19) and surfaced through its `title`. */
export function agentTitle(agent: ViewAgent): string {
  const parts = [agent.label];
  if (agent.model) parts.push(agent.model);
  if (agent.attempt !== undefined) parts.push(`attempt ${agent.attempt}`);
  parts.push(`${agent.toolCalls} ${agent.toolCalls === 1 ? 'tool call' : 'tool calls'}`);
  return parts.join(' · ');
}

export function formatAgentTokens(tokens: number): string {
  return tokens < 1000 ? `${tokens}` : `${(tokens / 1000).toFixed(1)}k`;
}

export function formatAgentDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
