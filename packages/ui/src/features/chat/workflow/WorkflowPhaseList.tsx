/**
 * The run timeline: one spine, and only phases that have something to say take
 * vertical space — the pending tail collapses into a single "Up next" row (the
 * old list repeated "not started" per phase). Running and failed phases open
 * their steps themselves; anything else expands on click.
 */
import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ClaudeWorkflowPhase } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { formatAgentDuration, type ViewAgent, type ViewRun } from './workflow-agent-view';
import { runTimeline, type PhaseView } from './workflow-phase-view';
import { WorkflowAgentRow } from './WorkflowAgentRow';
import { WorkflowPip } from './WorkflowPip';

const PHASE_ROW = 'flex h-6.5 w-full items-center gap-2 rounded-sm px-2.5 text-left';
const CHEVRON = 'shrink-0 text-muted-foreground transition-transform';
const MONO_META = 'shrink-0 font-mono text-xs tabular-nums text-muted-foreground';

function StepBlock({ agents, run }: { agents: ViewAgent[]; run: ViewRun }) {
  return (
    <div className="mr-2.5 mb-1.5 ml-5.5">
      {agents.map((agent, position) => (
        <WorkflowAgentRow key={agent.agentId} agent={agent} run={run} last={position === agents.length - 1} />
      ))}
    </div>
  );
}

function WorkflowPhaseRow({ view, run, last }: { view: PhaseView; run: ViewRun; last: boolean }) {
  const { phase, agents, status, durationMs } = view;
  const hasSteps = agents.length > 0;
  const autoOpen = status === 'running' || status === 'failed';
  const [open, setOpen] = useState(autoOpen);

  // A phase that starts (or fails) after mount opens itself; a deliberate
  // close sticks until the status actually changes again.
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  return (
    <section data-testid={`chat-workflow-phase-${phase.index}`} className="relative">
      {!last && <span aria-hidden className="absolute top-5 bottom-0 left-[13.5px] w-px bg-border" />}
      <button
        type="button"
        data-testid={`chat-workflow-phase-toggle-${phase.index}`}
        disabled={!hasSteps}
        onClick={() => setOpen((o) => !o)}
        className={cn(PHASE_ROW, hasSteps && 'transition-colors hover:bg-foreground/5')}
      >
        <WorkflowPip status={status} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-xs font-medium',
            status === 'pending' ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {phase.title}
        </span>
        {hasSteps && <span className={MONO_META}>{formatAgentDuration(durationMs)}</span>}
        {hasSteps && <ChevronDown size={10} className={cn(CHEVRON, !open && '-rotate-90')} aria-hidden />}
      </button>
      {hasSteps && open && <StepBlock agents={agents} run={run} />}
    </section>
  );
}

/** The pending tail, one quiet row: "Up next · Implement, Review, QA". */
function WorkflowUpNext({ phases }: { phases: ClaudeWorkflowPhase[] }) {
  const [open, setOpen] = useState(false);
  if (phases.length === 0) return null;
  return (
    <div data-testid="chat-workflow-upnext">
      <button
        type="button"
        data-testid="chat-workflow-upnext-toggle"
        onClick={() => setOpen((o) => !o)}
        className={cn(PHASE_ROW, 'transition-colors hover:bg-foreground/5')}
      >
        <WorkflowPip status="pending" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {open ? 'Up next' : `Up next · ${phases.map((phase) => phase.title).join(', ')}`}
        </span>
        <span className={MONO_META}>{phases.length}</span>
        <ChevronDown size={10} className={cn(CHEVRON, !open && '-rotate-90')} aria-hidden />
      </button>
      {open &&
        phases.map((phase) => (
          <div
            key={phase.index}
            data-testid={`chat-workflow-upnext-${phase.index}`}
            className="flex h-5.5 items-center gap-2 pr-2.5 pl-[30px]"
          >
            <span aria-hidden className="size-1 shrink-0 rounded-full bg-muted-foreground/60" />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{phase.title}</span>
          </div>
        ))}
    </div>
  );
}

export function WorkflowPhaseList({ run }: { run: ViewRun }) {
  const { shown, upNext, orphans } = runTimeline(run);

  return (
    <div>
      {shown.map((view, position) => (
        <WorkflowPhaseRow
          key={view.phase.index}
          view={view}
          run={run}
          last={position === shown.length - 1 && upNext.length === 0}
        />
      ))}
      <WorkflowUpNext phases={upNext} />
      {orphans.length > 0 && (
        // A run rebuilt without its phase list would otherwise drop every agent it does have.
        <section data-testid="chat-workflow-phase-unassigned">
          <div className={cn('flex items-baseline gap-2 px-2.5 pb-1', shown.length + upNext.length > 0 && 'pt-2')}>
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">Agents</span>
            <span className={MONO_META}>{orphans.length}</span>
          </div>
          <div className="mr-2.5 ml-5.5">
            {orphans.map((agent, position) => (
              <WorkflowAgentRow key={agent.agentId} agent={agent} run={run} last={position === orphans.length - 1} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
