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
 * Finder "Favorites" gray. Replaces the app-wide
 * `text-micro font-bold uppercase tracking-wide` eyebrow antipattern.
 */
export function SectionHeader({ children, trailing, className, ...rest }: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-2 pb-1 pt-1.5',
        'text-caption font-medium text-muted-foreground',
        className,
      )}
      {...rest}
    >
      <span>{children}</span>
      {trailing}
    </div>
  );
}
