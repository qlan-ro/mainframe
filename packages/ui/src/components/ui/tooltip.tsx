import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          // Arbitrary px padding: app-tauri compresses the integer spacing scale
          // (--spacing-2 = 4px), so `px-2 py-1` rendered as a cramped 4px/2px.
          'z-50 overflow-hidden rounded-lg border border-border bg-popover px-[10px] py-[6px]',
          // Default width floor so long content wraps instead of stretching the
          // tooltip across the viewport. Callers override via a `max-w-*` class.
          'max-w-xs break-words',
          'text-caption leading-snug text-popover-foreground',
          'shadow-[var(--mf-shadow-pop)]',
          'animate-in fade-in-0 zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          'data-[side=bottom]:slide-in-from-top-2',
          'data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2',
          'data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
