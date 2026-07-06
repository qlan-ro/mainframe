/**
 * pairing-shared — shared primitives for AddRemoteDialog.
 *
 * Exported: StepRail, NoticeCard, UrlChip, UrlAdornment and their prop types.
 */
import { Globe, Check, AlertTriangle, Lock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// StepRail
// ---------------------------------------------------------------------------

const STEPS = ['Connect', 'Pair'] as const;

export interface StepRailProps {
  current: 0 | 1;
}

export function StepRail({ current }: StepRailProps) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center">
            {i > 0 && (
              <div className={cn('h-[1.5px] w-[22px] transition-colors', done ? 'bg-mf-success' : 'bg-border')} />
            )}
            <div className="flex flex-col items-center gap-[3px]">
              <div
                className={cn(
                  'flex size-[18px] items-center justify-center rounded-full text-micro font-bold transition-colors',
                  done && 'bg-mf-success text-white',
                  active && 'bg-primary text-primary-foreground',
                  !done && !active && 'bg-mf-chip text-mf-text-3',
                )}
              >
                {done ? <Check size={10} strokeWidth={2.5} /> : i + 1}
              </div>
              <span className={cn('text-micro', active ? 'font-semibold text-foreground' : 'text-mf-text-3')}>
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NoticeCard
// ---------------------------------------------------------------------------

export type NoticeKind = 'success' | 'error' | 'info';

export interface NoticeCardProps {
  kind: NoticeKind;
  children: React.ReactNode;
  action?: React.ReactNode;
  testId?: string;
}

const NOTICE_STYLES: Record<NoticeKind, string> = {
  success: 'bg-mf-success-tint border-mf-success/30 text-foreground',
  error: 'bg-destructive/8 border-destructive/30 text-foreground',
  info: 'bg-mf-content2 border-border text-muted-foreground',
};

const NOTICE_ICON: Record<NoticeKind, React.ReactNode> = {
  success: <Check size={13} className="shrink-0 text-mf-success" />,
  error: <AlertTriangle size={13} className="shrink-0 text-destructive" />,
  info: <Globe size={13} className="shrink-0 text-muted-foreground" />,
};

export function NoticeCard({ kind, children, action, testId }: NoticeCardProps) {
  return (
    <div
      data-testid={testId}
      className={cn('flex items-start gap-[7px] rounded-md border px-[10px] py-[8px]', NOTICE_STYLES[kind])}
    >
      {NOTICE_ICON[kind]}
      <span className="min-w-0 flex-1 text-caption leading-normal">{children}</span>
      {action != null && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UrlChip — locked URL display for step 1
// ---------------------------------------------------------------------------

export function UrlChip({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-[6px] rounded-md border border-border bg-mf-content2 px-[10px] py-[6px]">
      <Check size={12} className="shrink-0 text-mf-success" />
      <span className="min-w-0 flex-1 truncate font-mono text-caption text-foreground">{url}</span>
      <Lock size={12} className="shrink-0 text-mf-text-3" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// UrlAdornment — right-side icon for the URL input
// ---------------------------------------------------------------------------

export type UrlPhase = 'idle' | 'verifying' | 'reachable' | 'unreachable';

export function UrlAdornment({ phase }: { phase: UrlPhase }) {
  if (phase === 'verifying') return <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />;
  if (phase === 'reachable') return <Check size={14} className="shrink-0 text-mf-success" />;
  if (phase === 'unreachable') return <AlertTriangle size={14} className="shrink-0 text-destructive" />;
  return <Globe size={14} className="shrink-0 text-mf-text-3" />;
}
