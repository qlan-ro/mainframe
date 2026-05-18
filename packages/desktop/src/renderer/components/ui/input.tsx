import * as React from 'react';
import { cn } from '../../lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

function Input({ className, type, ref, ...props }: InputProps & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-8 w-full rounded-mf-card border border-mf-border bg-mf-input-bg px-3 py-1 text-mf-body text-mf-text-primary transition-colors file:border-0 file:bg-transparent file:text-mf-body file:font-medium placeholder:text-mf-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-mf-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

export { Input };
