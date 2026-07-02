import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

function Checkbox({ className, ...props }: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer h-[17px] w-[17px] shrink-0 rounded-[5px] border-[1.5px] border-mf-text-4',
        'shadow-none transition-colors',
        'focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-[0.45]',
        'data-[state=checked]:bg-primary data-[state=checked]:border-0',
        'data-[state=checked]:text-primary-foreground',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className={cn('flex items-center justify-center text-current')}>
        <CheckIcon className="size-[11px]" strokeWidth={2.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
