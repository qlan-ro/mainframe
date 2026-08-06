'use client';

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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@v2/components/ui/collapsible';
import { cn } from '@v2/lib/utils';
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
}

export function CollapsibleCardShell({
  testId,
  triggerId,
  result,
  isError,
  defaultOpen = false,
  disableTrigger = false,
  icon,
  verb,
  target,
  trailing,
  children,
  className,
  subHeader,
}: CollapsibleCardShellProps) {
  const hasBody = Boolean(children);

  return (
    <Collapsible
      data-testid={testId}
      defaultOpen={defaultOpen}
      className={cn(cardStyle(result, isError), 'w-full', className)}
    >
      <CollapsibleTrigger
        data-testid={triggerId}
        disabled={disableTrigger || !hasBody}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted',
          "[&_svg]:shrink-0 [&_svg]:text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5",
          (disableTrigger || !hasBody) && 'cursor-default',
        )}
      >
        {icon}
        <span className="shrink-0 font-medium text-foreground">{verb}</span>
        {target && <span className="min-w-0 truncate">{target}</span>}
        <span className="min-w-2 flex-1" />
        {trailing && <span className="flex shrink-0 items-center gap-1.5">{trailing}</span>}
      </CollapsibleTrigger>

      {subHeader}

      {hasBody && (
        <CollapsibleContent
          className={cn(
            'overflow-hidden',
            'data-[state=open]:animate-collapsible-down',
            'data-[state=closed]:animate-collapsible-up',
            'data-[state=closed]:fill-mode-forwards',
          )}
        >
          {children}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
