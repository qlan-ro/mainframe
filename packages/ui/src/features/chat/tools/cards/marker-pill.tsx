/**
 * Shared chrome for the "centered note on the chat spine" tool family — MCP,
 * worktree enter/exit, schedule/cron/monitor, skill-loaded.
 *
 * These are the v2 `Marker variant="separator"` recipe: a centered label between
 * two hairlines. That is already what `SystemMessage` renders for compaction and
 * system notes, and these sit in the same column carrying the same role — the
 * bordered `rounded-full` pill they used to be read as a different feature next
 * to its own siblings. The label drops its mono, too: these are prose notes, and
 * mono is reserved for hashes, hosts, ports and counts.
 *
 * The `MarkerPill` name and props are kept: the pill is the *interactive*
 * element inside the row, and every card's testid hangs off it.
 */
import React, { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';

// ── MarkerWrap ────────────────────────────────────────────────────────────────

/** Stacks the marker row and its optional disclosure body on the chat spine. */
export function MarkerWrap({ children }: { children: React.ReactNode }) {
  return <div className="my-1.5 flex w-full flex-col gap-2">{children}</div>;
}

// ── MarkerPill ────────────────────────────────────────────────────────────────

export type MarkerState = 'done' | 'pending' | 'error';

export interface MarkerPillProps {
  icon: React.ReactNode;
  state?: MarkerState;
  expandable?: boolean;
  open?: boolean;
  onClick?: () => void;
  title?: string;
  children: React.ReactNode;
  /** data-testid for the pill button */
  testId?: string;
}

export function MarkerPill({
  icon,
  state = 'done',
  expandable = false,
  open = false,
  onClick,
  title,
  children,
  testId,
}: MarkerPillProps) {
  const isError = state === 'error';
  const isPending = state === 'pending';
  const clickable = expandable && !isPending && !isError;

  return (
    <Marker variant="separator" className={cn('select-none', isError && 'text-destructive')}>
      <Hint label={title}>
        <button
          data-testid={testId}
          type="button"
          disabled={!clickable}
          onClick={clickable ? onClick : undefined}
          className={cn(
            'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors',
            clickable ? 'cursor-pointer hover:bg-muted hover:text-foreground' : 'cursor-default',
          )}
        >
          <MarkerIcon>{icon}</MarkerIcon>
          <MarkerContent>{children}</MarkerContent>
          {isPending && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground" />}
          {isError && <span className="size-1.5 shrink-0 rounded-full bg-destructive" />}
          {clickable &&
            (open ? <ChevronDownIcon className="size-3 shrink-0" /> : <ChevronRightIcon className="size-3 shrink-0" />)}
        </button>
      </Hint>
    </Marker>
  );
}

// ── MarkerBody ────────────────────────────────────────────────────────────────

/** Disclosure body shown below a marker row when expanded. */
export function MarkerBody({
  children,
  testId = 'marker-body',
}: {
  children: React.ReactNode;
  /** data-testid override — pass a card-specific id when multiple marker bodies can be on screen at once. */
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="w-full overflow-hidden rounded-lg border border-border bg-card px-3 py-2.5">
      {children}
    </div>
  );
}

// ── MarkerCapsLabel ───────────────────────────────────────────────────────────

/** ARGUMENTS / RESULT section label inside a MarkerBody. */
export function MarkerCapsLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-xs font-medium text-muted-foreground">{children}</div>;
}

// ── MarkerPre ─────────────────────────────────────────────────────────────────

/** Preformatted mono text inside a MarkerBody. */
export function MarkerPre({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <pre
      className={cn(
        'font-mono text-xs leading-snug wrap-break-word whitespace-pre-wrap',
        muted ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      {children}
    </pre>
  );
}

// ── useMarkerOpen ─────────────────────────────────────────────────────────────

/** Local open/close state for expandable marker rows. */
export function useMarkerOpen(defaultOpen = false) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => setOpen((v) => !v);
  return { open, toggle };
}
