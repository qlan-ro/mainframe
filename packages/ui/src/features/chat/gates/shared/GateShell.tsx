import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type GateAccent = 'primary' | 'warning';

/**
 * An unresolved gate reads as live via a tinted border + ring — Radix's own
 * focus vocabulary, so it follows light/dark for free. It replaced an inline
 * `boxShadow` built from `color-mix(…)` per accent, which could not.
 */
const ACCENT_RING: Record<GateAccent, string> = {
  primary: 'border-primary/40 ring-3 ring-primary/15',
  warning: 'border-warning/40 ring-3 ring-warning/15',
};

/**
 * Left inset that lines a gate's body rows up with GateHead's text column:
 * the px-4 gutter + the size-6 tile + the gap-2.5 between them. One constant so
 * the two consumers cannot drift from the head.
 */
export const GATE_BODY_INSET = 'pl-[calc(1rem+1.5rem+0.625rem)]';

export function GateCardShell({
  resolved,
  accent = 'primary',
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { resolved?: boolean; accent?: GateAccent; children: ReactNode }) {
  return (
    // No width of its own: the gate matches the composer by inheriting the transcript column (#297).
    <div
      data-testid="chat-gate-card"
      className={cn(
        'overflow-hidden rounded-xl border bg-card',
        resolved ? 'border-border' : ACCENT_RING[accent],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function GateHead({
  icon,
  eyebrow,
  eyebrowClassName = 'text-muted-foreground',
  title,
  subtitle,
  tileClassName,
  right,
}: {
  icon: ReactNode;
  eyebrow: string;
  eyebrowClassName?: string;
  title: string;
  subtitle?: ReactNode;
  tileClassName?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
      <span
        data-testid="gate-head-tile"
        className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-md', tileClassName)}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn('text-xs font-medium', eyebrowClassName)}>{eyebrow}</span>
        <span className="text-sm leading-tight font-semibold text-foreground">{title}</span>
        {subtitle != null && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </div>
      {right}
    </div>
  );
}
