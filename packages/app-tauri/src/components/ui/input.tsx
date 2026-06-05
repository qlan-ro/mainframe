import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

function Input({ className, type, ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1.5',
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
}

export { Input };
