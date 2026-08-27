import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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
