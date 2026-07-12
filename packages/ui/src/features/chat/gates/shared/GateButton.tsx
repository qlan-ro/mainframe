import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type GateButtonKind = 'primary' | 'ghost' | 'danger';

const KIND_CLASS: Record<GateButtonKind, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  ghost: 'bg-background text-foreground hover:bg-accent',
  danger: 'border border-border bg-transparent text-destructive hover:bg-mf-destructive-tint',
};

export function GateButton({
  kind = 'ghost',
  className,
  ...props
}: ComponentProps<typeof Button> & { kind?: GateButtonKind }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className={cn('h-8 px-3.5 text-body font-semibold', KIND_CLASS[kind], className)}
      {...props}
    />
  );
}
