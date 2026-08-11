/**
 * One agent step inside a phase: spine pip, mono label, observed metrics, and
 * an opt-in note disclosure instead of the old truncated detail line. The note
 * is the same single detail (stale > error > result > tool precedence, AC 11)
 * — errors and stale notes open themselves, the rest sit behind the chevron.
 * `model`, `attempt` and the tool-call count stay in the row's `title` (D19).
 */
import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  agentDetailKind,
  agentDetailLine,
  agentTitle,
  formatAgentDuration,
  formatAgentTokens,
  type DetailKind,
  type ViewAgent,
  type ViewRun,
} from './workflow-agent-view';
import { agentPipStatus } from './workflow-phase-view';
import { WorkflowPip } from './WorkflowPip';

const NOTE_TONE: Record<DetailKind, string> = {
  stale: 'text-muted-foreground',
  error: 'text-destructive',
  result: 'text-muted-foreground',
  tool: 'text-muted-foreground',
};

/** What went wrong surfaces itself; results and tool lines wait for a click. */
const OPENS_ITSELF: Record<DetailKind, boolean> = { stale: true, error: true, result: false, tool: false };

export function WorkflowAgentRow({ agent, run, last = true }: { agent: ViewAgent; run: ViewRun; last?: boolean }) {
  const note = agentDetailLine(agent, run);
  const kind = agentDetailKind(agent);
  const hasNote = note !== null && kind !== null;
  const autoOpen = kind !== null && OPENS_ITSELF[kind];
  const [open, setOpen] = useState(autoOpen);

  // A failure that lands after mount must still surface its note.
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  return (
    <div
      data-testid={`chat-workflow-agent-${agent.agentId}`}
      data-state={agent.state}
      title={agentTitle(agent)}
      className="relative pl-4"
    >
      <span aria-hidden className={cn('absolute top-0 left-[5.5px] w-px bg-border', last ? 'h-[11px]' : 'bottom-0')} />
      <span className="absolute top-2 left-[3px]">
        <WorkflowPip status={agentPipStatus(agent)} className="size-1.5" />
      </span>
      <button
        type="button"
        data-testid={`chat-workflow-agent-toggle-${agent.agentId}`}
        disabled={!hasNote}
        onClick={() => setOpen((o) => !o)}
        className="flex h-5.5 w-full items-center gap-1.5 text-left"
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-mono text-xs',
            agent.state === 'unknown' ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {agent.label}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {/* A just-spawned agent has no usage yet — "0 · 2s" is noise. */}
          {agent.tokens > 0 ? `${formatAgentTokens(agent.tokens)} · ` : ''}
          {formatAgentDuration(agent.durationMs)}
        </span>
        {hasNote && (
          <ChevronDown
            size={10}
            className={cn('shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90')}
            aria-hidden
          />
        )}
      </button>
      {hasNote && open && (
        <div
          data-testid={`chat-workflow-agent-note-${agent.agentId}`}
          className={cn(
            'mt-px mb-1.5 rounded-sm border border-border bg-muted/40 px-1.5 py-1 text-xs leading-relaxed break-words',
            NOTE_TONE[kind],
          )}
        >
          {note}
        </div>
      )}
    </div>
  );
}
