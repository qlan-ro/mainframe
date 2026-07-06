import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

function Label({ className, ...props }: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        'text-label font-medium text-foreground leading-none',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-[0.45]',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
