import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { cn } from '@/lib/utils';

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)} {...props}>
      {/*
        Radix wraps viewport children in `<div style="min-width:100%;display:table">`.
        `display:table` shrink-wraps to content width, which defeats `min-w-0`/`truncate`
        on flex rows — they grow past the viewport and trailing controls get clipped by
        the root's `overflow-hidden`. Forcing that wrapper to `block` gives it a definite
        viewport-bounded width so truncation works. All our ScrollAreas are vertical.

        `block!`, not `!block`: Tailwind v4 moved the important modifier to a suffix, so
        the v3 prefix form compiles to nothing — this rule silently did nothing until
        2026-07-16.
      */}
      <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit] [&>div]:block!">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      orientation={orientation}
      className={cn(
        'flex touch-none select-none transition-colors',
        orientation === 'vertical' && 'h-full w-2 border-l border-l-transparent p-px',
        orientation === 'horizontal' && 'h-2 flex-col border-t border-t-transparent p-px',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-mf-text-4" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
