/**
 * PanelEyebrow — the docked panel's section header: an uppercase eyebrow
 * label, an optional live dot (something in the section is running) and an
 * optional trailing action. Static, not a trigger — the panel is one scrolling
 * column of first-class sections, none collapsible, none counted. Also exports
 * the row shapes every section shares.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const EYEBROW = 'text-xs font-semibold tracking-wide text-muted-foreground uppercase';

/** A section's body: rows under the eyebrow, on the panel's 16px row edge. */
export const SECTION_BODY = 'flex flex-col gap-0.5 px-2 pb-2';
/** An interactive row (a file, a skill): flat, hover-washed, `text-sm`. */
export const PANEL_ROW_BUTTON =
  'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-foreground/8';
/** Every section's empty row. */
export const PANEL_EMPTY = 'px-2 py-1 text-sm text-muted-foreground';

interface PanelEyebrowProps {
  label: string;
  /** Something in this section is live; the tooltip on the rows says what. */
  live?: boolean;
  liveTestId?: string;
  /** One control on the trailing edge (Skills' Manage). */
  action?: ReactNode;
  className?: string;
}

export function PanelEyebrow({ label, live = false, liveTestId, action, className }: PanelEyebrowProps) {
  return (
    <div className={cn('flex h-8 shrink-0 items-center gap-2 px-2', className)}>
      <span className={cn(EYEBROW, 'min-w-0 truncate')}>{label}</span>
      {live && (
        <span
          data-testid={liveTestId}
          aria-label="running"
          className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
        />
      )}
      {action != null && (
        <>
          <span className="flex-1" />
          {action}
        </>
      )}
    </div>
  );
}
