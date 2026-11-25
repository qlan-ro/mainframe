/**
 * A marker (T1g): a centred pill on the spine, outside the folded work. 26 px,
 * fully rounded, hairline, icon then label. One with content opens a card
 * under it.
 */
import { useId, type ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { RowGlyph, Spinner } from '../../messages/turn/RowGlyph';
import { useRowAnchor } from '../../messages/turn/use-row-anchor';
import { useRowOpen } from '../../messages/turn/use-row-open';

export interface MarkerPillProps {
  /** Disclosure identity, kept across virtualization. */
  rowKey: string;
  testId: string;
  icon: LucideIcon;
  label: string;
  target?: string;
  mono?: boolean;
  receipt?: string;
  state?: 'done' | 'running' | 'failed';
  hint?: string;
  activityId?: string;
  children?: ReactNode;
}

function Pill(props: MarkerPillProps & { open: boolean; toggle: () => void; bodyId: string }) {
  const { target, receipt, state = 'done', children, open } = props;
  const expandable = Boolean(children);
  return (
    <Hint label={props.hint}>
      <button
        type="button"
        data-testid={props.testId}
        data-state={state}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable && open ? props.bodyId : undefined}
        onClick={props.toggle}
        className={cn(
          'inline-flex h-6.5 max-w-full min-w-0 items-center gap-1.5 rounded-[13px] bg-card px-[11px] mf-tr-marker-label shadow-[inset_0_0_0_1px_var(--border)] text-(--mf-tr-muted) focus-visible:focus-line [&>svg]:size-3.5',
          expandable && 'hover:bg-muted hover:text-foreground',
          state === 'failed' && 'text-fail',
        )}
      >
        <RowGlyph icon={props.icon} status={state === 'failed' ? 'failed' : 'success'} />
        <span className="min-w-0 truncate">
          {props.label}
          {target && (
            <>
              {' '}
              <span className={cn('text-foreground', props.mono ? 'mf-tr-mono' : 'font-medium')}>{target}</span>
            </>
          )}
        </span>
        {(receipt || state === 'running') && (
          <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
            <span aria-hidden>·</span>
            {state === 'running' && <Spinner className="size-3" />}
            {receipt}
          </span>
        )}
        {expandable && (
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3! shrink-0 transition-transform duration-150 motion-reduce:transition-none',
              open && 'rotate-90',
            )}
          />
        )}
      </button>
    </Hint>
  );
}

export function MarkerPill(props: MarkerPillProps) {
  const { open, setOpen } = useRowOpen(props.rowKey);
  const { rowRef, beforeToggle } = useRowAnchor(open);
  const bodyId = useId();
  const toggle = () => {
    beforeToggle();
    setOpen(!open);
  };
  return (
    <div ref={rowRef} data-activity-id={props.activityId} className="flex w-full min-w-0 flex-col items-center gap-1.5">
      <Pill {...props} open={open} toggle={toggle} bodyId={bodyId} />
      {open && props.children && (
        <MarkerCard id={bodyId} testId={`${props.testId}-body`}>
          {props.children}
        </MarkerCard>
      )}
    </div>
  );
}

/** The card under a pill, and an answered question's own. */
export function MarkerCard({ id, testId, children }: { id?: string; testId: string; children: ReactNode }) {
  return (
    <div
      id={id}
      data-testid={testId}
      className="mb-1 w-full max-w-[600px] min-w-0 rounded-xl border border-border bg-card px-3.5 py-2.5 mf-tr-marker-body"
    >
      {children}
    </div>
  );
}
