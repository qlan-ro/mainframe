import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({ className, type, ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-8 w-full rounded-md border-[0.5px] border-input bg-card px-3 py-1.5',
        'text-body placeholder:text-muted-foreground',
        'transition-colors',
        'focus-visible:outline-none focus-visible:ring-0',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-body file:font-medium',
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export { Input };
