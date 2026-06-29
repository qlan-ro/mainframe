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
