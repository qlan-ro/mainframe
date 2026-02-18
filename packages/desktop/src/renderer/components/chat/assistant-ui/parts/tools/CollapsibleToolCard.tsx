import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../../../../lib/utils';

interface CollapsibleToolCardProps {
  /** 'primary' for file/command cards, 'compact' for read/search/metadata cards */
  variant?: 'primary' | 'compact';
  /** Outer wrapper className — defaults to 'overflow-hidden' */
  wrapperClassName?: string;
  /** Disable toggling (e.g. PlanCard with no result) */
  disabled?: boolean;
  /** Content between chevron and flex spacer */
  header: React.ReactNode;
  /** Content after flex spacer (status dots, action buttons) */
  trailing?: React.ReactNode;
  /** Content shown between header and expanded area when NOT open */
  subHeader?: React.ReactNode;
  /** Content shown when expanded */
  children?: React.ReactNode;
}

export function CollapsibleToolCard({
  variant = 'primary',
  wrapperClassName,
  disabled,
  header,
  trailing,
  subHeader,
  children,
}: CollapsibleToolCardProps) {
  const [open, setOpen] = useState(false);
  const isPrimary = variant === 'primary';

  return (
    <div className={wrapperClassName ?? 'overflow-hidden'}>
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center gap-2 px-3 text-mf-body transition-colors',
          isPrimary ? 'py-1.5 hover:bg-mf-hover/30' : 'py-0.5 hover:bg-mf-hover/20',
          disabled && 'cursor-default',
        )}
      >
        <ChevronRight
          size={14}
          className={cn(
            'transition-transform duration-150',
            isPrimary ? 'text-mf-text-secondary/60' : 'text-mf-text-secondary/40',
            open && 'rotate-90',
          )}
        />
        {header}
        <span className="flex-1" />
        {trailing}
      </button>
      {!open && subHeader}
      {open && children}
    </div>
  );
}
