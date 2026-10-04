/**
 * AutomationSidebarRow — one 36px automation in the sidebar list: the trigger
 * glyph, the name, a status dot (running `primary` pulsing / needs-you
 * `warning` / disabled muted), and the compact last-run time. Click opens the
 * automation's details in the modal (the same path the toasts take).
 *
 * data-testid: automations-sidebar-row-<id>.
 */
import { CalendarClock, Hand, Webhook, Zap, type LucideIcon } from 'lucide-react';
import { FadeLabel } from '@/components/ui/fade-label';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import type { AutomationRowStatus, AutomationRowVm, AutomationTriggerKind } from './automation-row-view';
import { formatLastRun } from './automation-row-view';

const TRIGGER_ICON: Record<AutomationTriggerKind, LucideIcon> = {
  schedule: CalendarClock,
  event: Zap,
  webhook: Webhook,
  manual: Hand,
};

const STATUS_LABEL: Record<AutomationRowStatus, string> = {
  running: 'Running',
  'needs-you': 'Needs you',
  disabled: 'Disabled',
  idle: 'Idle',
};

function StatusDot({ status }: { status: AutomationRowStatus }) {
  return (
    <Hint label={STATUS_LABEL[status]}>
      <span
        data-testid="automations-sidebar-row-status"
        data-status={status}
        aria-label={STATUS_LABEL[status]}
        className={cn(
          'size-2 shrink-0 rounded-full',
          status === 'running' && 'animate-pulse bg-primary motion-reduce:animate-none',
          status === 'needs-you' && 'bg-warning',
          status === 'disabled' && 'border-[1.5px] border-muted-foreground',
          status === 'idle' && 'bg-muted-foreground/50',
        )}
      />
    </Hint>
  );
}

export function AutomationSidebarRow({ row, now, onOpen }: { row: AutomationRowVm; now: number; onOpen: () => void }) {
  const Icon = TRIGGER_ICON[row.trigger];
  const lastRun = formatLastRun(row.lastRunAt, now);
  return (
    <button
      type="button"
      data-testid={`automations-sidebar-row-${row.id}`}
      onClick={onOpen}
      className={cn(
        'flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-sidebar-accent',
        row.status === 'disabled' && 'text-muted-foreground',
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <FadeLabel className="flex-1">{row.name}</FadeLabel>
      <StatusDot status={row.status} />
      <span className="w-7 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
        {lastRun ?? '—'}
      </span>
    </button>
  );
}
