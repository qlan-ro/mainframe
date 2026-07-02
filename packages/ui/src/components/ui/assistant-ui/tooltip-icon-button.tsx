'use client';

import { type ComponentPropsWithoutRef } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, TOOLTIP_DELAY_MS } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type TooltipIconButtonProps = ComponentPropsWithoutRef<typeof Button> & {
  tooltip: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
};

export function TooltipIconButton({ children, tooltip, side = 'bottom', className, ...rest }: TooltipIconButtonProps) {
  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" {...rest} className={cn('aui-button-icon size-6 p-1', className)}>
            {children}
            <span className="sr-only">{tooltip}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side={side}>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

TooltipIconButton.displayName = 'TooltipIconButton';
