/**
 * Phase-level view-model for the workflow run panel: each phase's derived
 * status and duration, and the timeline split — every phase up to the deepest
 * one that has spawned agents renders in full, the trailing tail collapses
 * into a single "Up next" row. Pure and React-free, computed over the already
 * neutralized agents (workflow-agent-view), so a terminal run's lingering
 * agents read `unknown` here too.
 */
import type { ClaudeWorkflowPhase } from '@qlan-ro/mainframe-types';
import type { ViewAgent, ViewRun } from './workflow-agent-view';

export type PhaseStatus = 'pending' | 'running' | 'done' | 'failed' | 'unknown';

export interface PhaseView {
  phase: ClaudeWorkflowPhase;
  agents: ViewAgent[];
  status: PhaseStatus;
  /** Longest agent duration — a phase's agents run concurrently, so max, not sum. */
  durationMs: number;
}

export interface RunTimeline {
  /** One view per seeded phase, in CLI order — the progress rail reads this. */
  all: PhaseView[];
  /** The timeline: every phase up to the deepest agent-bearing one. */
  shown: PhaseView[];
  /** The trailing phases nothing has reached yet — the "Up next" row. */
  upNext: ClaudeWorkflowPhase[];
  /** Agents whose phaseIndex was never seeded (a run rebuilt without phases). */
  orphans: ViewAgent[];
}

/** An agent's pip on the shared phase/step shape language. */
export function agentPipStatus(agent: ViewAgent): PhaseStatus {
  switch (agent.state) {
    case 'done':
      return 'done';
    case 'error':
      return 'failed';
    case 'unknown':
      return 'unknown';
    default:
      return 'running';
  }
}

function agentsStatus(agents: readonly ViewAgent[]): PhaseStatus {
  if (agents.length === 0) return 'pending';
  if (agents.some((agent) => agent.state === 'start' || agent.state === 'progress')) return 'running';
  if (agents.some((agent) => agent.state === 'error')) return 'failed';
  if (agents.some((agent) => agent.state === 'done')) return 'done';
  return 'unknown';
}

export function runTimeline(run: ViewRun): RunTimeline {
  const seeded = new Set(run.phases.map((phase) => phase.index));
  const orphans = run.agents.filter((agent) => !seeded.has(agent.phaseIndex));

  const all = run.phases.map((phase): PhaseView => {
    const agents = run.agents.filter((agent) => agent.phaseIndex === phase.index);
    return {
      phase,
      agents,
      status: agentsStatus(agents),
      durationMs: agents.reduce((max, agent) => Math.max(max, agent.durationMs), 0),
    };
  });

  const deepest = all.reduce((acc, view, position) => (view.agents.length > 0 ? position : acc), -1);
  // Between agent waves every spawned agent can read done while the script is
  // still executing — the deepest active phase stays running so the timeline
  // never flickers complete mid-run.
  const active = deepest >= 0 ? all[deepest] : undefined;
  if (run.status === 'running' && active !== undefined && active.status === 'done') {
    all[deepest] = { ...active, status: 'running' };
  }

  return { all, shown: all.slice(0, deepest + 1), upNext: run.phases.slice(deepest + 1), orphans };
}

/** The phase the header's progress line names: the deepest live one, else the first failure. */
export function currentPhase(timeline: RunTimeline): PhaseView | undefined {
  return (
    [...timeline.shown].reverse().find((view) => view.status === 'running') ??
    timeline.shown.find((view) => view.status === 'failed')
  );
}

export function donePhaseCount(timeline: RunTimeline): number {
  return timeline.all.filter((view) => view.status === 'done').length;
}
