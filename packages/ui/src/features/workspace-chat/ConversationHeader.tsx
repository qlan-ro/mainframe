/**
 * ConversationHeader — the row on top of a chat or agent tab (W8): what it is,
 * its title and kind, its status, and what can be done to it. The same for a
 * sub-agent and a delegated task; only the glyph and the kind line differ.
 */
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/** A sub-agent's tab uses four of these (`agent-status`); a delegated task's record has them all. */
export type AgentStatus = 'running' | 'needs-you' | 'queued' | 'completed' | 'failed' | 'stopped' | 'cancelled';

const STATUS: Record<AgentStatus, { label: string; className: string }> = {
  running: { label: 'running', className: 'text-muted-foreground' },
  'needs-you': { label: 'needs you', className: 'font-medium text-warning' },
  queued: { label: 'queued', className: 'text-muted-foreground' },
  completed: { label: 'done', className: 'text-muted-foreground' },
  failed: { label: 'failed', className: 'text-fail' },
  stopped: { label: 'stopped', className: 'text-muted-foreground' },
  cancelled: { label: 'stopped', className: 'text-muted-foreground' },
};

interface AgentStatusLabelProps {
  status: AgentStatus;
  /** Instead of the status's own word. */
  label?: string;
  testId: string;
}

export function AgentStatusLabel({ status, label, testId }: AgentStatusLabelProps) {
  const { label: word, className } = STATUS[status];
  return (
    <span data-testid={testId} data-status={status} className={`shrink-0 text-meta/[1.45] ${className}`}>
      {label ?? word}
    </span>
  );
}

/** Immediate, as every Stop is (K4): no confirmation. */
export function StopButton({ title, busy, onStop, testId }: StopButtonProps) {
  return (
    <Button
      data-testid={testId}
      variant="ghost"
      size="sm"
      aria-label={`Stop ${title}`}
      disabled={busy}
      onClick={onStop}
      className="h-7 shrink-0 text-destructive hover:bg-destructive/12 hover:text-destructive"
    >
      Stop
    </Button>
  );
}

interface StopButtonProps {
  title: string;
  busy: boolean;
  onStop: () => void;
  testId: string;
}

interface ConversationHeaderProps {
  testId: string;
  glyph: ReactNode;
  title: string;
  kind: ReactNode;
  children?: ReactNode;
}

export function ConversationHeader({ testId, glyph, title, kind, children }: ConversationHeaderProps) {
  return (
    <div
      data-testid={testId}
      className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 py-3 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground"
    >
      {glyph}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-semibold" title={title}>
          {title}
        </span>
        <span className="truncate text-meta/[1.45] text-muted-foreground">{kind}</span>
      </span>
      {children}
    </div>
  );
}
