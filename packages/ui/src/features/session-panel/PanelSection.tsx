/**
 * PanelSection — the session panel's section frame and row, so every section
 * keeps one rhythm: a sentence-case label close to its rows, 28px rows on a
 * 16px icon lane, 10px of air under the section, and a hairline above every
 * section but the first, inset to line up with the text.
 */
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionPanelSectionKey } from '@/store/ui-prefs';
import { SECTION_LABEL } from './panel-sections';

/** A section's label line: 22px, its text sitting on the bottom edge. */
export const SECTION_HEADER =
  'mt-3 flex h-[22px] w-full shrink-0 items-end gap-1.5 px-4 pb-1 text-left text-xs font-medium text-muted-foreground';

const ROW = 'mx-1.5 flex h-7 w-[calc(100%-0.75rem)] min-w-0 items-center gap-2 rounded-md px-2.5 text-left text-sm';

interface PanelSectionProps extends Omit<ComponentPropsWithRef<'section'>, 'title'> {
  section: SessionPanelSectionKey;
  /** One control on the label's trailing edge (Skills' Manage). */
  action?: ReactNode;
  /** Replaces the label line (Plan's is a disclosure). */
  header?: ReactNode;
}

export function PanelSection({ section, action, header, className, children, ...props }: PanelSectionProps) {
  return (
    <section
      aria-label={SECTION_LABEL[section]}
      className={cn(
        'relative shrink-0 pb-2.5',
        "not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border not-first:before:content-['']",
        className,
      )}
      {...props}
    >
      {header ?? (
        <div className={SECTION_HEADER}>
          <h3 className="min-w-0 truncate">{SECTION_LABEL[section]}</h3>
          {action != null && <span className="ml-auto flex">{action}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/** The 16px lane every row leads with; empty keeps the title on the text column. */
export function RowIcon({ children }: { children?: ReactNode }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-4" aria-hidden>
      {children}
    </span>
  );
}

interface PanelRowProps extends Omit<ComponentPropsWithRef<'button'>, 'title' | 'value'> {
  icon?: ReactNode;
  label: ReactNode;
  labelClassName?: string;
  /** The value lane at the row's end. */
  value?: ReactNode;
}

export function PanelRow({ icon, label, labelClassName, value, className, ...props }: PanelRowProps) {
  return (
    <button
      type="button"
      className={cn(
        ROW,
        'transition-colors hover:bg-foreground/8 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RowIcon>{icon}</RowIcon>
      <span className={cn('min-w-0 flex-1 truncate', labelClassName)}>{label}</span>
      {value != null && <RowValue>{value}</RowValue>}
    </button>
  );
}

export function RowValue({ className, ...props }: ComponentPropsWithRef<'span'>) {
  return (
    <span
      className={cn('flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums', className)}
      {...props}
    />
  );
}

/** A section's empty state, on the text column like its rows. */
export function PanelEmpty({
  icon,
  className,
  children,
  ...props
}: ComponentPropsWithRef<'div'> & { icon?: ReactNode }) {
  return (
    <div
      className={cn('mx-1.5 flex min-h-7 items-center gap-2 px-2.5 text-sm text-muted-foreground', className)}
      {...props}
    >
      {icon != null && <RowIcon>{icon}</RowIcon>}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** "Show all N" / "Show fewer" under a capped list. */
export function ShowAllRow({
  count,
  all,
  onToggle,
  testId,
}: {
  count: number;
  all: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <PanelRow
      data-testid={testId}
      aria-expanded={all}
      onClick={onToggle}
      icon={all ? <ChevronUp className="size-3.5!" /> : <ChevronDown className="size-3.5!" />}
      label={all ? 'Show fewer' : `Show all ${count}`}
      labelClassName="text-muted-foreground"
    />
  );
}
