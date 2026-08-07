/**
 * App-owned primitive on v2 tokens. `components/ui/` is no longer a v1 mirror of
 * the shadcn registry — that is `src/v2/components/ui/`, kept stock. What lives
 * here has no registry counterpart and is ours to shape.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SectionHeaderProps {
  children: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * Shared section/eyebrow header: sentence-case caption in muted ink — the
 * Finder "Favorites" gray. Replaces the app-wide 10px
 * `font-bold uppercase tracking-wide` eyebrow antipattern.
 */
export function SectionHeader({ children, trailing, className, ...rest }: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-2 pb-1 pt-1.5',
        'text-xs font-medium text-muted-foreground',
        className,
      )}
      {...rest}
    >
      <span>{children}</span>
      {trailing}
    </div>
  );
}
