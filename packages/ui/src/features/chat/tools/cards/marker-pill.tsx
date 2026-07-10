/**
 * Shared Marker Pill chrome for the "centered pill on the chat spine" family.
 *
 * Design contract (10-chatcards.jsx MarkerWrap/MarkerPill/MarkerBody):
 *   - Centered column wrapper (MarkerWrap) — `flex flex-col items-center`
 *   - Pill: bg-mf-content2, border-border, rounded-full, font-mono text-caption
 *     text-mf-text-3. Error: red-tinted border + bg. Pending: pulsing dot.
 *   - Expandable: chevron right/down; disclosure body below (rounded-lg, bg-mf-content2).
 *   - Accent token via text-primary for the meaningful name.
 *
 * NO /opacity modifier on any --mf-* vars (CSS-var hex trap).
 */
import React, { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';

// ── MarkerWrap ────────────────────────────────────────────────────────────────

/** Centers its children on the chat spine with a vertical gap. */
export function MarkerWrap({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-4 my-2.5 w-full">{children}</div>;
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
    <Hint label={title}>
      <button
        data-testid={testId}
        type="button"
        disabled={!clickable}
        onClick={clickable ? onClick : undefined}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full pt-[4px] pr-[11px] pb-[4px] pl-[9px]',
          'font-mono text-caption text-mf-text-3 select-none',
          'border border-border bg-mf-content2',
          'transition-colors duration-100',
          clickable && 'hover:bg-accent cursor-pointer',
          !clickable && 'cursor-default',
          isError && 'border-destructive bg-mf-destructive-tint',
          'max-w-full overflow-hidden',
        )}
      >
        <span className="shrink-0 text-mf-text-4">{icon}</span>
        <span className="truncate min-w-0">{children}</span>
        {isPending && <span className="w-1.5 h-1.5 rounded-full bg-mf-text-4 animate-pulse shrink-0" />}
        {isError && <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />}
        {clickable &&
          (open ? (
            <ChevronDownIcon size={11} className="text-mf-text-4 shrink-0" />
          ) : (
            <ChevronRightIcon size={11} className="text-mf-text-4 shrink-0" />
          ))}
      </button>
    </Hint>
  );
}

// ── MarkerBody ────────────────────────────────────────────────────────────────

/** Disclosure body shown below a marker pill when expanded. */
export function MarkerBody({
  children,
  testId = 'marker-body',
}: {
  children: React.ReactNode;
  /** data-testid override — pass a card-specific id when multiple marker bodies can be on screen at once. */
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="w-full rounded-lg border border-border bg-mf-content2 px-3 py-2.5 overflow-hidden"
    >
      {children}
    </div>
  );
}

// ── MarkerCapsLabel ───────────────────────────────────────────────────────────

/** ARGUMENTS / RESULT section label inside a MarkerBody. */
export function MarkerCapsLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-micro font-bold tracking-wide uppercase text-mf-text-3 mb-1">{children}</div>;
}

// ── MarkerPre ─────────────────────────────────────────────────────────────────

/** Preformatted mono text inside a MarkerBody. */
export function MarkerPre({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <pre
      className={cn(
        'font-mono text-caption whitespace-pre-wrap break-words leading-snug',
        muted ? 'text-mf-text-3' : 'text-foreground',
      )}
    >
      {children}
    </pre>
  );
}

// ── useMarkerOpen ─────────────────────────────────────────────────────────────

/** Local open/close state for expandable marker pills. */
export function useMarkerOpen(defaultOpen = false) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => setOpen((v) => !v);
  return { open, toggle };
}
