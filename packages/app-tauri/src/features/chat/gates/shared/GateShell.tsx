import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function GateCardShell({
  resolved,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { resolved?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-background',
        resolved ? 'border-border' : 'border-mf-border-hover shadow-[var(--mf-shadow-pop)]',
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
        className={cn('inline-flex size-6 items-center justify-center rounded-md', tileClassName)}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn('text-micro font-bold uppercase tracking-normal', eyebrowClassName)}>{eyebrow}</span>
        <span className="text-body font-semibold leading-tight text-foreground">{title}</span>
      </div>
      {right}
    </div>
  );
}
