import * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';
import { cn } from '@v2/lib/utils';

function Progress({ className, value, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    // `value` reaches the Root as well as the indicator: it drives the visual
    // via the transform below, but Radix needs it to leave `indeterminate` and
    // emit aria-valuenow. With no value at all, Radix flags the indeterminate
    // state and the indicator sweeps instead.
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/20', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-primary transition-all data-[state=indeterminate]:w-2/5 data-[state=indeterminate]:animate-[ws-indeterminate_1.5s_ease-in-out_infinite]"
        style={value == null ? undefined : { transform: `translateX(-${100 - value}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
