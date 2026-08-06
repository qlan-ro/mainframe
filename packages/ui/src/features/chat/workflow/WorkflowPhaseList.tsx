/**
 * One section per phase, in the order the CLI seeded them. A phase with no agents
 * still renders — the CLI publishes the whole phase list from `meta.phases` before
 * anything runs, and what is still coming is the most informative thing on the panel.
 */
import { cn } from '@/lib/utils';
import type { ViewAgent, ViewRun } from './workflow-agent-view';
import { WorkflowAgentRow } from './WorkflowAgentRow';

function PhaseHeader({ title, meta, first }: { title: string; meta: string; first: boolean }) {
  return (
    <div className={cn('flex items-baseline gap-2 px-1.5 pb-1', first ? 'pt-0.5' : 'pt-3.5')}>
      <span className="min-w-0 flex-1 truncate text-caption font-medium text-muted-foreground">{title}</span>
      <span className="shrink-0 text-caption text-muted-foreground">{meta}</span>
    </div>
  );
}

function phaseMeta(kind: string | undefined, count: number): string {
  if (count === 0) return 'not started';
  return kind ? `${kind} · ${count}` : `${count}`;
}

export function WorkflowPhaseList({ run }: { run: ViewRun }) {
  const seeded = new Set(run.phases.map((phase) => phase.index));
  const orphans = run.agents.filter((agent) => !seeded.has(agent.phaseIndex));

  return (
    <div>
      {run.phases.map((phase, position) => {
        const agents = run.agents.filter((agent) => agent.phaseIndex === phase.index);
        return (
          // `phase.index` is the CLI's own phase number — the domain id — not the array position.
          <section key={phase.index} data-testid={`chat-workflow-phase-${phase.index}`}>
            <PhaseHeader title={phase.title} meta={phaseMeta(phase.kind, agents.length)} first={position === 0} />
            <PhaseAgents agents={agents} run={run} />
          </section>
        );
      })}
      {orphans.length > 0 && (
        // A run rebuilt without its phase list would otherwise drop every agent it does have.
        <section data-testid="chat-workflow-phase-unassigned">
          <PhaseHeader title="Agents" meta={`${orphans.length}`} first={run.phases.length === 0} />
          <PhaseAgents agents={orphans} run={run} />
        </section>
      )}
    </div>
  );
}

function PhaseAgents({ agents, run }: { agents: ViewAgent[]; run: ViewRun }) {
  return (
    <>
      {agents.map((agent) => (
        <WorkflowAgentRow key={agent.agentId} agent={agent} run={run} />
      ))}
    </>
  );
}
