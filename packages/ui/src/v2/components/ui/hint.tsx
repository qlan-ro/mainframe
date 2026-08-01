import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@v2/components/ui/tooltip';

interface HintProps {
  /** Empty/nullish renders the child bare, so conditional `label={cond ? 'x' : undefined}` call sites keep their behavior. */
  label: ReactNode;
  children: ReactElement;
  side?: ComponentPropsWithoutRef<typeof TooltipContent>['side'];
  sideOffset?: number;
}

/**
 * Themed replacement for native `title=` tooltips.
 *
 * The `TooltipProvider` is for isolation: Radix throws without one, and rows are
 * rendered bare in unit tests. Nesting under `SidebarProvider`'s own provider is
 * harmless — both use the stock zero delay.
 */
export function Hint({ label, children, side, sideOffset }: HintProps) {
  if (label === null || label === undefined || label === '') return children;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} sideOffset={sideOffset}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface DismissibleHintProps extends HintProps {
  /** Once true the child renders bare, forever — wire this to a persisted preference. */
  dismissed: boolean;
  onDismiss: () => void;
  dismissLabel?: string;
  dismissTestId?: string;
}

/** A {@link Hint} carrying a "don't show anymore" affordance. The caller owns where the flag is stored. */
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
    <TooltipProvider>
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
    </TooltipProvider>
  );
}
