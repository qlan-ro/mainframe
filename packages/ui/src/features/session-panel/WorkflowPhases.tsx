/**
 * WorkflowPhases — a workflow row unfolded: its numbered phases with their
 * state, the running phase's agents, the agents no phase names, and Stop while
 * it runs.
 */
import { useRef, type ReactNode } from 'react';
import { Bot, Check, Circle, CircleStop, CircleX } from 'lucide-react';
import type { ClaudeWorkflowRun } from '@qlan-ro/mainframe-types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { WorkflowRunPanel } from '@/features/chat/workflow/WorkflowRunPanel';
import { formatAgentDuration, neutralizedRun, type ViewAgent } from '@/features/chat/workflow/workflow-agent-view';
import {
  agentPipStatus,
  runTimeline,
  type PhaseStatus,
  type PhaseView,
} from '@/features/chat/workflow/workflow-phase-view';
import { isTerminalRunStatus } from '@/features/chat/workflow/workflow-progress';
import { cn } from '@/lib/utils';
import { ActivitySpinner } from './ActivitySpinner';
import { useFocusLoss } from './use-row-focus';

/** A phase's glyph, its word for screen readers, and the value when it has no time to show. */
const PHASE: Record<PhaseStatus, { glyph: ReactNode; label: string; value: string }> = {
  done: { glyph: <Check className="size-3 text-success" />, label: 'done', value: '' },
  running: { glyph: <ActivitySpinner />, label: 'running', value: '' },
  failed: { glyph: <CircleX className="size-3 text-fail" />, label: 'failed', value: 'failed' },
  unknown: { glyph: <CircleStop className="size-3" />, label: 'stopped', value: 'stopped' },
  pending: { glyph: <Circle className="size-2" />, label: 'waiting', value: 'waiting' },
};

function StatusGlyph({ status }: { status: PhaseStatus }) {
  return (
    <span className="flex size-3 shrink-0 items-center justify-center" aria-hidden>
      {PHASE[status].glyph}
    </span>
  );
}

/** Opens the run's detail panel beside the panel; the workspace Agent tab takes over in W8. */
function AgentRow({ agent, run }: { agent: ViewAgent; run: ClaudeWorkflowRun }) {
  const status = agentPipStatus(agent);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`session-panel-workflow-agent-${agent.agentId}`}
          aria-label={`Open ${agent.label}, ${PHASE[status].label}, ${formatAgentDuration(agent.durationMs)}`}
          className="-mx-1.5 flex h-[26px] w-[calc(100%+0.75rem)] items-center gap-2 rounded-md pr-1.5 pl-[26px] text-left transition-colors hover:bg-foreground/8"
        >
          <Bot className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-foreground">{agent.label}</span>
          <StatusGlyph status={status} />
          <span className="shrink-0 tabular-nums">{formatAgentDuration(agent.durationMs)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        className="w-[380px] overflow-hidden p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <WorkflowRunPanel run={run} />
      </PopoverContent>
    </Popover>
  );
}

/** Agents in a phase run side by side, so the longest one stands for the phase. */
const longestAgentMs = (view: PhaseView): number => Math.max(0, ...view.agents.map((agent) => agent.durationMs));

function PhaseRow({ view, position, run }: { view: PhaseView; position: number; run: ClaudeWorkflowRun }) {
  const { label, value } = PHASE[view.status];
  const running = view.agents.filter((agent) => agent.state === 'start' || agent.state === 'progress');
  return (
    <li data-testid={`session-panel-workflow-phase-${view.phase.index}`} data-status={view.status}>
      <div className="flex h-6 items-center gap-2">
        <StatusGlyph status={view.status} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            view.status === 'running' && 'font-medium text-foreground',
            view.status === 'done' && 'text-foreground',
          )}
        >
          {position}. {view.phase.title}
          <span className="sr-only">, {label}</span>
        </span>
        <span className={cn('shrink-0 tabular-nums', view.status === 'failed' && 'text-fail')}>
          {value || formatAgentDuration(longestAgentMs(view))}
        </span>
      </div>
      {view.status === 'running' && running.map((agent) => <AgentRow key={agent.agentId} agent={agent} run={run} />)}
    </li>
  );
}

/** A run rebuilt without its phase list, or with an agent no phase names, still lists every agent it has. */
function PhaselessAgents({ agents, run }: { agents: ViewAgent[]; run: ClaudeWorkflowRun }) {
  return (
    <div role="group" aria-label="Agents outside the phases" data-testid="session-panel-workflow-phaseless">
      <div className="flex h-6 items-center">Agents</div>
      {agents.map((agent) => (
        <AgentRow key={agent.agentId} agent={agent} run={run} />
      ))}
    </div>
  );
}

interface StopRunProps {
  title: string;
  stopping: boolean;
  onStop: () => void;
  onFocusLost?: () => void;
}

function StopRun({ title, stopping, onStop, onFocusLost }: StopRunProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useFocusLoss(ref, onFocusLost);
  return (
    <button
      ref={ref}
      type="button"
      data-testid="session-panel-workflow-stop"
      aria-label={stopping ? `Stopping ${title}` : `Stop ${title}`}
      aria-disabled={stopping}
      onClick={onStop}
      className="-ml-2 flex h-6 items-center rounded-md px-2 font-medium text-destructive transition-colors hover:bg-destructive/10 aria-disabled:pointer-events-none aria-disabled:text-muted-foreground"
    >
      {stopping ? 'Stopping' : 'Stop'}
    </button>
  );
}

export function WorkflowPhases({
  title,
  run,
  now,
  onStop,
  stopping = false,
  onFocusLost,
}: {
  title: string;
  run: ClaudeWorkflowRun;
  now: number;
  onStop?: () => void;
  stopping?: boolean;
  /** Stop is going away with the focus on it. */
  onFocusLost?: () => void;
}) {
  const view = neutralizedRun(run, now);
  const { all: phases, orphans } = runTimeline(view);
  return (
    <div className="mx-1.5 mb-1.5 pt-0.5 pr-2.5 pb-1 pl-[34px] text-xs text-muted-foreground">
      {phases.length === 0 && orphans.length === 0 && (
        <p className="py-1">{isTerminalRunStatus(run.status) ? 'No phases were reported' : 'No phases reported yet'}</p>
      )}
      {phases.length > 0 && (
        <ol aria-label={`${title} phases`}>
          {phases.map((phase, index) => (
            <PhaseRow key={phase.phase.index} view={phase} position={index + 1} run={run} />
          ))}
        </ol>
      )}
      {orphans.length > 0 && <PhaselessAgents agents={orphans} run={run} />}
      {onStop && <StopRun title={title} stopping={stopping} onStop={onStop} onFocusLost={onFocusLost} />}
    </div>
  );
}
