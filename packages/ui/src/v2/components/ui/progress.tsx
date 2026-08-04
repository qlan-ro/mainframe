import * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';
import { cn } from '@v2/lib/utils';

function Progress({ className, value, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    // `value` reaches the Root as well as the indicator: it drives the visual
    // via the transform below, but Radix needs it to leave `indeterminate` and
    // emit aria-valuenow.
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/20', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
