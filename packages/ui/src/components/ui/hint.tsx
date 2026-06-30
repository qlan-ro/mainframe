import * as React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

type HintProps = {
  /** Tooltip text. When empty/falsy the child renders bare (no tooltip) so
   * conditional `title={cond ? 'x' : undefined}` call sites keep their behavior. */
  label: React.ReactNode;
  /** Single trigger element — receives the Radix trigger props via `asChild`. */
  children: React.ReactElement;
  side?: React.ComponentPropsWithoutRef<typeof TooltipContent>['side'];
  sideOffset?: number;
};

/**
 * Themed replacement for native `title=` tooltips: wraps a trigger element in the
 * shared shadcn/Radix tooltip. Self-contained `TooltipProvider` (matching
 * `TooltipIconButton`) so it works in isolation — in the app under the root
 * provider (app/main.tsx) and in unit tests that render a component bare.
 */
export function Hint({ label, children, side, sideOffset }: HintProps) {
  if (label === null || label === undefined || label === '') return children;
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} sideOffset={sideOffset}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

Hint.displayName = 'Hint';

type DismissibleHintProps = HintProps & {
  /** When true the hint is suppressed entirely (child renders bare) — wire this to a persisted preference. */
  dismissed: boolean;
  /** Invoked when the user clicks the dismiss affordance; persist the suppression here. */
  onDismiss: () => void;
  /** Text of the dismiss affordance. */
  dismissLabel?: string;
  /** Optional testid for the dismiss button. */
  dismissTestId?: string;
};

/**
 * A {@link Hint} that carries a "don't show anymore" affordance. While not yet
 * dismissed it behaves like Hint but its content adds a dismiss button; once
 * `dismissed` is true (e.g. a persisted preference) the child renders bare,
 * forever. Presentational only — the caller owns where the flag is stored.
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
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} sideOffset={sideOffset} className="flex flex-col items-start gap-1.5">
          <span>{label}</span>
          <button
            type="button"
            data-testid={dismissTestId}
            onClick={onDismiss}
            className="text-micro font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            {dismissLabel}
          </button>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

DismissibleHint.displayName = 'DismissibleHint';
