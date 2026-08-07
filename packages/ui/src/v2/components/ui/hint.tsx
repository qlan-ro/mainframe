import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@v2/components/ui/tooltip';

interface HintProps {
  label: ReactNode;
  children: ReactElement;
  side?: ComponentPropsWithoutRef<typeof TooltipContent>['side'];
  sideOffset?: number;
}

/**
 * Themed replacement for native `title=` — the stock three-part tooltip behind
 * one `label` prop, since a row needs several of these and each costs four
 * components inline.
 *
 * No `TooltipProvider` of its own: shadcn documents that as an app-root concern,
 * and `SidebarProvider` already mounts one at the stock zero delay.
 */
export function Hint({ label, children, side, sideOffset }: HintProps) {
  // Empty label → bare child, so `label={cond ? 'x' : undefined}` call sites skip the tooltip.
  if (label === null || label === undefined || label === '') return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={sideOffset}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

interface DismissibleHintProps extends HintProps {
  /** Once true the child renders bare, forever — wire this to a persisted preference. */
  dismissed: boolean;
  onDismiss: () => void;
  dismissLabel?: string;
  dismissTestId?: string;
}

/**
 * A {@link Hint} carrying a "don't show anymore" affordance. The caller owns
 * where the flag is stored.
 *
 * Not expressible as tooltip props: the content holds a button. That works
 * because Radix keeps a tooltip open once the pointer enters its content.
 */
export function DismissibleHint({
  label,
  children,
  side,
  sideOffset,
  dismissed,
  onDismiss,
  dismissLabel = "Don't show anymore",
  dismissTestId,
}: DismissibleHintProps) {
  if (dismissed || label === null || label === undefined || label === '') return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={sideOffset} className="flex flex-col items-start gap-1.5">
        <span>{label}</span>
        <button
          type="button"
          data-testid={dismissTestId}
          onClick={onDismiss}
          className="text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          {dismissLabel}
        </button>
      </TooltipContent>
    </Tooltip>
  );
}
