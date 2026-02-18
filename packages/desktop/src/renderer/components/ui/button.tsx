import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-mf-card text-mf-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-mf-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-mf-text-primary text-mf-panel-bg hover:bg-mf-text-primary/90',
        destructive: 'bg-mf-destructive text-mf-text-primary hover:bg-mf-destructive/90',
        outline: 'border border-mf-border bg-transparent text-mf-text-primary hover:bg-mf-hover',
        secondary: 'bg-mf-hover text-mf-text-primary hover:bg-mf-hover/80',
        ghost: 'text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary',
        link: 'text-mf-accent underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2.5 text-mf-small',
        lg: 'h-9 px-4',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  ref,
  ...props
}: ButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
}

export { Button, buttonVariants };
