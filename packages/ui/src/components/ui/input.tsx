import * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:focus-line-inset disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-fail aria-invalid:ring-3 aria-invalid:ring-fail/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-fail/50 dark:aria-invalid:ring-fail/40',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
