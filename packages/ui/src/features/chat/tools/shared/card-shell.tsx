'use client';

/**
 * CollapsibleCardShell — shared chrome for all tool cards.
 *
 * Encapsulates: the card border/radius, CollapsibleTrigger header with a
 * 22×22 family tile (icon or glyph + token colour), a verb label, optional
 * target slot (e.g. ClickableFilePath), optional trailing slot (stat pills /
 * StatusDot), and the collapsible body.
 *
 * Token rules: no /opacity modifier on --mf-* hex vars (CSS-var hex trap).
 * Uses real globals.css tokens only.
 *
 * ErrorBody — the destructive-tinted pre shared by ReadFileCard and SearchCard
 * (previously byte-identical in both files).
 */
import React from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { cardStyle } from './chrome';

// ---------------------------------------------------------------------------
// FamilyTile — 22×22 coloured square holding an icon or a glyph character
// ---------------------------------------------------------------------------

export interface FamilyTileProps {
  /** Token-backed colour for the icon/glyph. */
  color: string;
  /** Token-backed background color string. */
  bg: string;
  /** React node rendered inside the tile (icon component or string glyph). */
  children: React.ReactNode;
}

export function FamilyTile({ color, bg, children }: FamilyTileProps) {
  return (
    <span
      aria-hidden
      className="w-[22px] h-[22px] rounded-sm shrink-0 flex items-center justify-center"
      style={{ backgroundColor: bg }}
    >
      <span className="text-caption font-bold leading-none select-none" style={{ color }}>
        {children}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// ErrorBody — destructive-tinted pre (shared by ReadFileCard & SearchCard)
// ---------------------------------------------------------------------------

export interface ErrorBodyProps {
  text: string;
  /** data-testid applied to the <pre> element. */
  testId?: string;
}

export function ErrorBody({ text, testId }: ErrorBodyProps) {
  return (
    <div className="relative">
      <div className="absolute inset-0 bg-destructive opacity-10 pointer-events-none" aria-hidden />
      <pre
        data-testid={testId}
        className="relative font-mono text-caption whitespace-pre-wrap break-words px-3 py-2 max-h-[300px] overflow-y-auto text-destructive"
      >
        {text}
      </pre>
    </div>
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
  /** The 22×22 family tile (use FamilyTile or a custom element). */
  tile: React.ReactNode;
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
  tile,
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
          'flex w-full items-center gap-[9px] px-[10px] py-[7px]',
          'text-body transition-colors hover:bg-accent',
          (disableTrigger || !hasBody) && 'cursor-default',
        )}
      >
        {tile}
        <span className="text-label font-semibold text-foreground shrink-0">{verb}</span>
        {target && <span className="min-w-0 truncate">{target}</span>}
        <span className="min-w-2 flex-1" />
        {trailing && <span className="flex items-center gap-1.5 shrink-0">{trailing}</span>}
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
