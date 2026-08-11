/**
 * One shape language for phases and steps: a filled dot per derived status,
 * hollow for what has not started or was never observed finishing. Running
 * pulses on the app's working hue (`primary`, the WorkingDot precedent).
 */
import { cn } from '@/lib/utils';
import type { PhaseStatus } from './workflow-phase-view';

const FILL: Record<PhaseStatus, string> = {
  done: 'bg-success',
  failed: 'bg-destructive',
  running: 'bg-primary motion-safe:animate-pulse',
  unknown: 'border border-muted-foreground',
  pending: 'border border-muted-foreground/60',
};

export function WorkflowPip({ status, className }: { status: PhaseStatus; className?: string }) {
  return (
    <span aria-hidden data-status={status} className={cn('size-2 shrink-0 rounded-full', FILL[status], className)} />
  );
}
