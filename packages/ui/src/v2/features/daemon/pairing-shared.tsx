/**
 * Shared pieces of the pairing dialog: the step rail, the notice card, the
 * locked-URL chip and the URL input's status adornment.
 *
 * Ported from the v1 warm-chrome originals onto the v2 tokens — success is
 * `--success`, resting ink is `muted-foreground`, fills are `muted`.
 */
import { AlertTriangleIcon, CheckIcon, GlobeIcon, Loader2Icon, LockIcon } from 'lucide-react';
import { cn } from '@v2/lib/utils';

const STEPS = ['Connect', 'Pair'] as const;

export function StepRail({ current }: { current: 0 | 1 }) {
  return (
    <div className="flex items-center">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center">
            {i > 0 && <div className={cn('h-px w-6 transition-colors', done ? 'bg-success' : 'bg-border')} />}
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'flex size-4.5 items-center justify-center rounded-full text-xs font-bold transition-colors',
                  done && 'bg-success text-primary-foreground',
                  active && 'bg-primary text-primary-foreground',
                  !done && !active && 'bg-muted text-muted-foreground',
                )}
              >
                {done ? <CheckIcon className="size-2.5" strokeWidth={2.5} /> : i + 1}
              </div>
              <span className={cn('text-xs', active ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export type NoticeKind = 'success' | 'error' | 'info';

const NOTICE_STYLES: Record<NoticeKind, string> = {
  success: 'bg-success/10 border-success/30 text-foreground',
  error: 'bg-destructive/10 border-destructive/30 text-foreground',
  info: 'bg-muted border-border text-muted-foreground',
};

const NOTICE_ICON: Record<NoticeKind, React.ReactNode> = {
  success: <CheckIcon className="size-3.5 shrink-0 text-success" />,
  error: <AlertTriangleIcon className="size-3.5 shrink-0 text-destructive" />,
  info: <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />,
};

export interface NoticeCardProps {
  kind: NoticeKind;
  children: React.ReactNode;
  action?: React.ReactNode;
  testId?: string;
}

export function NoticeCard({ kind, children, action, testId }: NoticeCardProps) {
  return (
    <div
      data-testid={testId}
      className={cn('flex items-start gap-2 rounded-md border px-2.5 py-2', NOTICE_STYLES[kind])}
    >
      {NOTICE_ICON[kind]}
      <span className="min-w-0 flex-1 text-xs">{children}</span>
      {action != null && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Locked URL display for step 1. */
export function UrlChip({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-muted px-2.5 py-1.5">
      <CheckIcon className="size-3 shrink-0 text-success" />
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{url}</span>
      <LockIcon className="size-3 shrink-0 text-muted-foreground" />
    </div>
  );
}

export type UrlPhase = 'idle' | 'verifying' | 'reachable' | 'unreachable';

/** Right-side status icon for the URL input. */
export function UrlAdornment({ phase }: { phase: UrlPhase }) {
  if (phase === 'verifying') return <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />;
  if (phase === 'reachable') return <CheckIcon className="size-3.5 shrink-0 text-success" />;
  if (phase === 'unreachable') return <AlertTriangleIcon className="size-3.5 shrink-0 text-destructive" />;
  return <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />;
}
