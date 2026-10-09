'use client';

import { useCompactDetail } from './compact-detail-context';

/**
 * CollapsibleCardShell — shared chrome for all tool cards.
 *
 * Encapsulates the card frame, a CollapsibleTrigger header (leading glyph, verb
 * label, optional target slot such as ClickableFilePath, optional trailing slot
 * for stat pills / StatusDot) and the collapsible body.
 *
 * The header glyph carries the TOOL FAMILY by shape only. The six
 * `--mf-tool-*` hues that used to tint a 22px tile are gone: the same rule the
 * workspace tab strip and the slash-command badge already follow — six tinted
 * tiles stacked down a transcript read as six features, and state is already
 * carried by the trailing StatusDot.
 *
 * ErrorBody — the destructive-tinted pre shared by ReadFileCard and SearchCard.
 */
import React from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { cardStyle } from './chrome';

// ---------------------------------------------------------------------------
// ErrorBody
// ---------------------------------------------------------------------------

export interface ErrorBodyProps {
  text: string;
  /** data-testid applied to the <pre> element. */
  testId?: string;
}

export function ErrorBody({ text, testId }: ErrorBodyProps) {
  return (
    <pre
      data-testid={testId}
      className="bg-destructive/10 px-3 py-2 font-mono text-xs wrap-break-word whitespace-pre-wrap text-destructive"
    >
      {text}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleCardShell
// ---------------------------------------------------------------------------

export interface CollapsibleCardShellProps {
  /** Top-level data-testid on the Collapsible root element. */
  testId: string;
  /** data-testid on the CollapsibleTrigger row. */
  triggerId: string;
  /** result + isError used to determine card border/bg via cardStyle. */
  result: unknown;
  isError: boolean | undefined;
  /** When true the card body is open on first render (Edit/Todo default true). */
  defaultOpen?: boolean;
  /** Controlled open state, for a card that opens itself (the `delegate_task` card on a pending gate). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Disable the trigger (no body to show yet). */
  disableTrigger?: boolean;
  /** Leading family glyph — a bare lucide icon; the trigger sizes and inks it. */
  icon: React.ReactNode;
  /** Short verb label, e.g. "Edit", "Write", "Bash". */
  verb: string;
  /** Optional clickable target (e.g. ClickableFilePath). Flex min-w-0 truncate. */
  target?: React.ReactNode;
  /** Trailing slot: stat pills, extra controls, StatusDot. Rendered right-aligned. */
  trailing?: React.ReactNode;
  /** The collapsible body. Only rendered when truthy. */
  children?: React.ReactNode;
  /** Extra className on the Collapsible root. */
  className?: string;
  /** Sub-header rendered between the trigger and the body (outside Collapsible). */
  subHeader?: React.ReactNode;
  /**
   * Header content rendered as a sibling of CollapsibleTrigger, not inside its
   * button — used for tool-result image thumbnails (todo #363), whose own
   * click/keydown must never toggle the card.
   */
  headerAccessory?: React.ReactNode;
}

function CardHeader(props: CollapsibleCardShellProps) {
  const disabled = props.disableTrigger || !props.children;
  return (
    <div className="flex w-full items-center">
      <CollapsibleTrigger
        data-testid={props.triggerId}
        disabled={disabled}
        className={cn(
          'flex flex-1 items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted',
          "[&_svg]:shrink-0 [&_svg]:text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5",
          disabled && 'cursor-default',
        )}
      >
        {props.icon}
        <span className="shrink-0 font-medium text-foreground">{props.verb}</span>
        {props.target && <span className="min-w-0 truncate">{props.target}</span>}
        <span className="min-w-2 flex-1" />
        {props.trailing && <span className="flex shrink-0 items-center gap-1.5">{props.trailing}</span>}
      </CollapsibleTrigger>
      {props.headerAccessory && (
        <span className="flex shrink-0 items-center gap-1.5 pr-3">{props.headerAccessory}</span>
      )}
    </div>
  );
}

export function CollapsibleCardShell(props: CollapsibleCardShellProps) {
  const compactDetail = useCompactDetail();
  return (
    <Collapsible
      data-testid={props.testId}
      defaultOpen={compactDetail || props.defaultOpen || false}
      open={props.open}
      onOpenChange={props.onOpenChange}
      className={cn(cardStyle(props.result, props.isError), 'w-full', props.className)}
    >
      <CardHeader {...props} />
      {props.subHeader}
      {Boolean(props.children) && (
        <CollapsibleContent
          className={cn(
            'overflow-hidden',
            !compactDetail &&
              'data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up data-[state=closed]:fill-mode-forwards',
          )}
        >
          {props.children}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
