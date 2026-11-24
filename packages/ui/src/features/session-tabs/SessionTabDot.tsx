/**
 * SessionTabDot — the 8px status mark that leads a session tab: filled blue
 * while the session works (its sub-agents count, L3), a warning ring while it
 * needs you, quiet grey otherwise.
 */
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';

export type SessionTabStatus = 'waiting' | 'working' | 'idle';

const LABELS: Record<SessionTabStatus, string | undefined> = {
  waiting: 'Needs you',
  working: 'Running',
  idle: undefined,
};

const DOTS: Record<SessionTabStatus, string> = {
  waiting: 'border-[1.5px] border-warning',
  working: 'bg-primary',
  idle: 'bg-muted-foreground/50',
};

export function SessionTabDot({ id, status }: { id: string; status: SessionTabStatus }) {
  const label = LABELS[status];
  return (
    <Hint label={label}>
      <span
        data-testid={status === 'waiting' ? `session-tab-waiting-${id}` : `session-tab-status-${id}`}
        data-status={status}
        role={label == null ? undefined : 'img'}
        aria-label={label}
        aria-hidden={label == null || undefined}
        className={cn('size-2 rounded-full', DOTS[status])}
      />
    </Hint>
  );
}
