import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type GateAccent = 'primary' | 'warning';

// Accent-tinted "live card" glow per gate type (blue for Question/Plan, amber for
// Permission) — replaces the generic popover shadow while a gate is unresolved.
const ACCENT_SHADOW: Record<GateAccent, CSSProperties> = {
  primary: { boxShadow: '0 1px 0 rgba(0,0,0,0.02), 0 6px 22px -12px color-mix(in srgb, var(--primary) 55%, transparent)' },
  warning: {
    boxShadow: '0 1px 0 rgba(0,0,0,0.02), 0 6px 22px -12px color-mix(in srgb, var(--mf-warning) 55%, transparent)',
  },
};

export function GateCardShell({
  resolved,
  accent = 'primary',
  children,
  className,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & { resolved?: boolean; accent?: GateAccent; children: ReactNode }) {
  return (
    <div
      className={cn(
        'max-w-[680px] overflow-hidden rounded-xl border bg-card',
        resolved ? 'border-border' : 'border-mf-border-hover',
        className,
      )}
      style={resolved ? style : { ...ACCENT_SHADOW[accent], ...style }}
      {...props}
    >
      {children}
    </div>
  );
}

export function GateHead({
  icon,
  eyebrow,
  eyebrowClassName = 'text-mf-text-3',
  title,
  tileClassName,
  right,
}: {
  icon: ReactNode;
  eyebrow: string;
  eyebrowClassName?: string;
  title: string;
  tileClassName?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3.5 pb-2 pt-3">
      <span
        data-testid="gate-head-tile"
        className={cn('inline-flex size-[26px] items-center justify-center rounded-md', tileClassName)}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn('text-micro font-bold uppercase tracking-wide', eyebrowClassName)}>{eyebrow}</span>
        <span className="text-body font-semibold leading-tight text-foreground">{title}</span>
      </div>
      {right}
    </div>
  );
}
