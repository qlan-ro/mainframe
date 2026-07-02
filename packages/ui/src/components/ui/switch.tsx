import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

function Switch({ className, ...props }: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
        'bg-input transition-colors',
        'focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-[0.45]',
        'data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-[18px] rounded-full bg-white shadow-sm',
          'transition-transform',
          'data-[state=checked]:translate-x-[16px]',
          'data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
