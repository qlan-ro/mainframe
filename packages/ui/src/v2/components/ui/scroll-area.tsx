import * as React from 'react';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import { cn } from '@v2/lib/utils';

function ScrollArea({ className, children, ...props }: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn('relative', className)} {...props}>
      {/*
        `[&>div]:block!`: Radix wraps viewport children in a `display:table` div,
        which shrink-wraps to content width. That defeats `min-w-0`/`truncate` on
        flex rows and collapses a virtualized list's measured height to one row.
        Forcing `block` gives the wrapper a viewport-bounded width.

        `block!`, not `!block`: Tailwind v4 moved the important modifier to a
        suffix, so the v3 prefix form compiles to nothing.
      */}
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 [&>div]:block!"
      >
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
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    // No `data-orientation` here: Radix sets it itself, and Tailwind's
    // `data-vertical` / `data-horizontal` variants read that same attribute.
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
