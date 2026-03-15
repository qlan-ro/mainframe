import React, { useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '../../../../../lib/utils';

interface CollapsibleToolCardProps {
  /** 'primary' for file/command cards, 'compact' for read/search/metadata cards */
  variant?: 'primary' | 'compact';
  /** Outer wrapper className — defaults to 'overflow-hidden' */
  wrapperClassName?: string;
  /** Disable toggling (e.g. PlanCard with no result) */
  disabled?: boolean;
  /** Start expanded */
  defaultOpen?: boolean;
  /** Status dot rendered at the start of the line */
  statusDot?: React.ReactNode;
  /** Content after status dot */
  header: React.ReactNode;
  /** Content after flex spacer (action buttons, etc.) */
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
  defaultOpen = false,
  statusDot,
  header,
  trailing,
  subHeader,
  children,
}: CollapsibleToolCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isPrimary = variant === 'primary';

  return (
    <div data-testid="tool-card" className={wrapperClassName ?? 'overflow-hidden'}>
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center gap-2 px-3 text-mf-body transition-colors',
          isPrimary ? 'py-1.5 hover:bg-mf-hover/30' : 'py-0.5 hover:bg-mf-hover/20',
          disabled && 'cursor-default',
        )}
      >
        {statusDot}
        {header}
        <span className="flex-1" />
        {!disabled &&
          (open ? (
            <Minimize2 size={14} className="text-mf-text-secondary/40 shrink-0" />
          ) : (
            <Maximize2 size={14} className="text-mf-text-secondary/40 shrink-0" />
          ))}
        {trailing}
      </button>
      {!open && subHeader}
      {open && children}
    </div>
  );
}
