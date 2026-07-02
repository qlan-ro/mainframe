import * as React from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { cn } from '@/lib/utils';

function RadioGroup({ className, ...props }: React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn('grid gap-2', className)} {...props} />;
}

function RadioGroupItem({ className, ...props }: React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'aspect-square h-[17px] w-[17px] rounded-full border-[1.5px] border-mf-text-4',
        'text-primary transition-colors',
        'focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-[0.45]',
        'data-[state=checked]:border-[5px] data-[state=checked]:border-primary',
        className,
      )}
      {...props}
    />
  );
}

export { RadioGroup, RadioGroupItem };
