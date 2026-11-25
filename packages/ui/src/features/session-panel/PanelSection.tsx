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
  'mt-3 flex h-[22px] w-full shrink-0 items-end gap-1.5 pr-3.5 pb-1 pl-4 text-left text-label/[1.45] font-medium text-muted-foreground';

const ROW =
  'mx-1.5 flex h-7 w-[calc(100%-0.75rem)] min-w-0 items-center gap-2 rounded-[7px] px-2.5 text-left text-body text-ink-secondary';

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

/** The 16px lane a row leads with (12px for a disclosure chevron); empty keeps the title on the text column. */
export function RowIcon({ children, small = false }: { children?: ReactNode; small?: boolean }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center text-muted-foreground',
        small ? 'size-3 [&>svg]:size-3' : 'size-4 [&>svg]:size-4',
      )}
      aria-hidden
    >
      {children}
    </span>
  );
}

interface PanelRowProps extends Omit<ComponentPropsWithRef<'button'>, 'title' | 'value'> {
  icon?: ReactNode;
  /** A disclosure chevron: its lane is as wide as the glyph. */
  smallIcon?: boolean;
  label: ReactNode;
  labelClassName?: string;
  /** The value lane at the row's end. */
  value?: ReactNode;
}

export function PanelRow({ icon, smallIcon, label, labelClassName, value, className, ...props }: PanelRowProps) {
  return (
    <button
      type="button"
      className={cn(
        ROW,
        'relative transition-colors hover:bg-sidebar-accent focus-visible:z-10 focus-visible:focus-line disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RowIcon small={smallIcon}>{icon}</RowIcon>
      <span className={cn('min-w-0 flex-1 truncate', labelClassName)}>{label}</span>
      {value != null && <RowValue>{value}</RowValue>}
    </button>
  );
}

export function RowValue({ className, ...props }: ComponentPropsWithRef<'span'>) {
  return (
    <span
      className={cn('flex shrink-0 items-center gap-1 text-meta/[1.45] text-muted-foreground tabular-nums', className)}
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
      className={cn('mx-1.5 flex min-h-7 items-center gap-2 px-2.5 text-body text-ink-secondary', className)}
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
      smallIcon
      icon={all ? <ChevronUp /> : <ChevronDown />}
      label={all ? 'Show fewer' : `Show all ${count}`}
    />
  );
}
