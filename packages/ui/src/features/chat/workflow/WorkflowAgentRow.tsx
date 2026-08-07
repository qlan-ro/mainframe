/**
 * One agent inside a phase: state dot, label, observed metrics and at most one
 * detail line. `model`, `attempt` and the tool-call count stay in the row's
 * `title` — the visible row carries only what a status readout needs (D19).
 *
 * An `unknown` agent is one nobody observed finishing, so its ornament asserts
 * nothing: a hollow ring, a muted label and an `unknown` chip. Its metrics are
 * still the real numbers the snapshot reported, at the same ink as everyone
 * else's — v2 has one muted tier, so the extra dimming has no token.
 */
import { cn } from '@/lib/utils';
import {
  agentDetailKind,
  agentDetailLine,
  agentDotPulse,
  agentDotTone,
  agentTitle,
  formatAgentDuration,
  formatAgentTokens,
  type DetailKind,
  type ViewAgent,
  type ViewRun,
} from './workflow-agent-view';
import type { OutcomeTone } from './workflow-progress';

const DOT_FILL: Record<Exclude<OutcomeTone, 'hollow'>, string> = {
  green: 'bg-success',
  amber: 'bg-warning',
  red: 'bg-destructive',
};

const DETAIL_TONE: Record<DetailKind, string> = {
  stale: 'text-muted-foreground',
  error: 'text-destructive',
  result: 'text-muted-foreground',
  tool: 'text-muted-foreground',
};

function AgentDot({ agent }: { agent: ViewAgent }) {
  const tone = agentDotTone(agent);
  if (tone === 'hollow') {
    return <span className="size-2 shrink-0 rounded-full border border-muted-foreground" aria-label="unknown" />;
  }
  return (
    <span
      aria-label={agent.state}
      className={cn(
        'size-2 shrink-0 rounded-full',
        DOT_FILL[tone],
        agentDotPulse(agent) && 'motion-safe:animate-pulse',
      )}
    />
  );
}

export function WorkflowAgentRow({ agent, run }: { agent: ViewAgent; run: ViewRun }) {
  const unknown = agent.state === 'unknown';
  const detail = agentDetailLine(agent, run);
  const kind = agentDetailKind(agent);

  return (
    <div
      data-testid={`chat-workflow-agent-${agent.agentId}`}
      data-state={agent.state}
      title={agentTitle(agent)}
      className="rounded-sm px-1.5 py-1.5"
    >
      <div className="flex items-center gap-2">
        <AgentDot agent={agent} />
        <span
          className={cn('min-w-0 flex-1 truncate text-label', unknown ? 'text-muted-foreground' : 'text-foreground')}
        >
          {agent.label}
        </span>
        {unknown && (
          <span className="shrink-0 rounded-xs bg-muted px-1 text-caption leading-none text-muted-foreground">
            unknown
          </span>
        )}
        <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
          {formatAgentTokens(agent.tokens)} · {formatAgentDuration(agent.durationMs)}
        </span>
      </div>
      {detail && kind && <p className={cn('mt-px truncate pl-4 text-caption', DETAIL_TONE[kind])}>{detail}</p>}
    </div>
  );
}
