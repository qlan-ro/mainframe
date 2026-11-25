/**
 * The one row of the transcript (T1): glyph, verb, target, where, receipt,
 * action, chevron. A row with a body is one button; what sits in the row over
 * it lets the press through, except its actions. The button is the first
 * `aria-expanded` control inside, which is how an Activity jump opens the row.
 */
import { useId, type ReactElement, type ReactNode, type Ref } from 'react';
import { Slot } from 'radix-ui';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRowAnchor } from './use-row-anchor';
import { useRowOpen } from './use-row-open';

export interface RowDisclosureProps {
  /** Disclosure identity: kept across virtualization and reloads of the window. */
  rowKey: string;
  testId: string;
  /** Accessible name, "Ran cargo test". */
  name: string;
  /** Read before the name by assistive tech: "Failed". */
  statusWord?: string;
  icon: ReactNode;
  verb: ReactNode;
  strong?: boolean;
  target?: string;
  mono?: boolean;
  where?: string;
  receipt?: ReactNode;
  tone?: 'fail' | 'warn';
  actions?: ReactNode;
  /** A press of the row's own, in place of unfolding: a trigger the row covers itself with. */
  press?: ReactElement;
  trailing?: ReactNode;
  children?: ReactNode;
  defaultOpen?: boolean;
  /** Child steps get a guide line; a body is indented under the verb. */
  steps?: boolean;
  filePath?: string;
  /** The tool the row stands for. */
  tool?: string;
  anchor?: { 'data-activity-id'?: string; 'data-activity-group'?: string };
}

const COVER = 'absolute inset-0 rounded-[6px] hover:bg-(--mf-tr-hover) focus-visible:focus-line-inset';
const TONES = { fail: 'text-fail', warn: 'font-medium text-warning' } as const;

function RowLine(props: RowDisclosureProps & { open: boolean; toggle: () => void; bodyId: string }) {
  const { target, where, receipt, children, open } = props;
  const expandable = Boolean(children);
  return (
    <div
      // A right-click on the row, not on its body, offers the file's paths.
      data-file-path={props.filePath}
      className="relative -mx-1.5 flex min-h-6.5 min-w-0 items-center gap-2 rounded-[6px] px-1.5 text-sm/[22px] text-(--mf-tr-secondary) [--muted-foreground:var(--mf-tr-muted)] [&>svg]:pointer-events-none [&>svg]:relative [&>svg]:size-3.5 [&>svg]:shrink-0"
    >
      {expandable && (
        <button
          type="button"
          data-testid={`${props.testId}-toggle`}
          aria-expanded={open}
          aria-controls={open ? props.bodyId : undefined}
          aria-label={props.name}
          title={props.name}
          onClick={props.toggle}
          className={COVER}
        />
      )}
      {props.press && <Slot.Root className={COVER}>{props.press}</Slot.Root>}
      {props.icon}
      <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2">
        {props.statusWord && <span className="sr-only">{props.statusWord}: </span>}
        <span className={cn('shrink-0 whitespace-nowrap', props.strong && 'font-medium text-foreground')}>
          {props.verb}
        </span>
        {target && (
          <span className={cn('min-w-0 truncate', props.mono ? 'mf-tr-mono text-foreground' : 'text-muted-foreground')}>
            {target}
          </span>
        )}
        {where && <span className="max-w-[40%] shrink-0 truncate">{where}</span>}
        <span className="min-w-1 flex-1" />
        {receipt && (
          <span
            data-testid={`${props.testId}-receipt`}
            className={cn('mf-tr-meta shrink-0 whitespace-nowrap tabular-nums', props.tone && TONES[props.tone])}
          >
            {receipt}
          </span>
        )}
      </span>
      {props.actions && <span className="relative -my-1 flex shrink-0 items-center">{props.actions}</span>}
      {expandable ? (
        <ChevronRight
          aria-hidden
          className={cn('size-3! transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-90')}
        />
      ) : (
        (props.trailing ?? <span aria-hidden className="size-3 shrink-0" />)
      )}
    </div>
  );
}

export function RowDisclosure(props: RowDisclosureProps) {
  const { open, setOpen } = useRowOpen(props.rowKey, props.defaultOpen);
  const { rowRef, beforeToggle } = useRowAnchor(open);
  const bodyId = useId();
  const toggle = () => {
    beforeToggle();
    setOpen(!open);
  };
  const body = open && props.children;
  return (
    <div
      ref={rowRef}
      data-testid={props.testId}
      data-state={open ? 'open' : 'closed'}
      data-tool={props.tool}
      className="group/row min-w-0"
      {...props.anchor}
    >
      <RowLine {...props} open={open} toggle={toggle} bodyId={bodyId} />
      {body && (
        <div
          id={bodyId}
          data-testid={`${props.testId}-body`}
          className={
            props.steps
              ? 'mt-px mb-1 ml-[7px] flex min-w-0 flex-col border-l border-border py-px pl-[15px]'
              : 'mt-0.5 mb-2 ml-5.5 min-w-0'
          }
        >
          {body}
        </div>
      )}
    </div>
  );
}

/** A 24 px action in a row or footer. */
export function RowAction({
  label,
  testId,
  onClick,
  hoverOnly = false,
  busy = false,
  ref,
  children,
}: {
  label: string;
  testId: string;
  onClick: () => void;
  /** Shown while the row is hovered or holds focus. */
  hoverOnly?: boolean;
  /** Under way: it keeps its place and focus, and takes no second click. */
  busy?: boolean;
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      aria-disabled={busy || undefined}
      onClick={busy ? undefined : onClick}
      className={cn(
        'size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:focus-line-inset [&_svg]:size-3.5',
        hoverOnly ? 'hidden group-focus-within/row:grid group-hover/row:grid [@media(hover:none)]:grid' : 'grid',
      )}
    >
      {children}
    </button>
  );
}
