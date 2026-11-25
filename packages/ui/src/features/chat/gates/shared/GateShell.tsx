import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { visibleLine } from '../visible-text';

type GateAccent = 'primary' | 'warning';

/**
 * An unresolved gate reads as live via a tinted border + ring — Radix's own
 * focus vocabulary, so it follows light/dark for free. It replaced an inline
 * `boxShadow` built from `color-mix(…)` per accent, which could not.
 */
const ACCENT_RING: Record<GateAccent, string> = {
  primary: 'border-primary/40 ring-3 ring-primary/15',
  warning: 'border-warning-dot/45 ring-3 ring-warning-dot/15',
};

/**
 * Left inset that lines a gate's body rows up with GateHead's text column:
 * the px-4 gutter + the size-6 tile + the gap-2.5 between them. One constant so
 * the two consumers cannot drift from the head.
 */
export const GATE_BODY_INSET = 'pl-[calc(1rem+1.5rem+0.625rem)]';

/** A gate's primary answer: white text needs the deeper blue (DESIGN.md, Deep Blue Fill). */
export const GATE_PRIMARY = 'bg-accent-fill text-white hover:brightness-108';

/** Every answer's button, and the outlined and refusing ones (DESIGN.md, Buttons). */
export const GATE_BUTTON = 'h-8 text-row font-medium shadow-none';
export const GATE_OUTLINE =
  'border-input bg-card text-foreground hover:bg-sidebar-accent dark:border-input dark:bg-card dark:hover:bg-sidebar-accent';
export const GATE_DANGER = 'bg-red/11 text-red hover:bg-red/19 dark:bg-red/11 dark:hover:bg-red/19';

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
        // `clip`, not `hidden`: it is no scroll container, so a sticky footer answers to the gate's slot.
        'overflow-clip rounded-tile border bg-card',
        resolved ? 'border-border' : ACCENT_RING[accent],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** The eyebrow and the title may be the asking agent's words: nothing in them hides, or moves the rest. */
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
        className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-sm', tileClassName)}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          data-testid="gate-head-eyebrow"
          dir="ltr"
          className={cn('stored-order text-label/[1.45] font-medium', eyebrowClassName)}
        >
          {visibleLine(eyebrow)}
        </span>
        <span
          data-testid="gate-head-title"
          dir="ltr"
          className="stored-order text-title/[1.3] font-semibold text-foreground"
        >
          {visibleLine(title)}
        </span>
        {subtitle != null && <span className="text-meta/[1.45] text-muted-foreground">{subtitle}</span>}
      </div>
      {right}
    </div>
  );
}
