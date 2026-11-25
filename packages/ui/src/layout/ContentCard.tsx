import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function ContentCard({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-testid="content-card"
      className={cn(
        'flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-[10px] border-t border-l bg-background',
        className,
      )}
      {...props}
    />
  );
}
