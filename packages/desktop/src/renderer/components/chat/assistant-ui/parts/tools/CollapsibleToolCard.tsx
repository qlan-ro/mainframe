import React, { useState, useCallback } from 'react';
import { Maximize2, Minimize2, Copy, Check } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/tooltip';

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
  /** Text to copy when the copy button is clicked (shown only when expanded) */
  copyText?: string;
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
  copyText,
}: CollapsibleToolCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const isPrimary = variant === 'primary';

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!copyText) return;
      navigator.clipboard.writeText(copyText).catch((err) => {
        console.warn('[CollapsibleToolCard] copy failed', err);
      });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    [copyText],
  );

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
        {trailing}
        {open && copyText && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="shrink-0 cursor-pointer"
                tabIndex={0}
                onClick={handleCopy}
                onKeyDown={(e) => e.key === 'Enter' && handleCopy(e as unknown as React.MouseEvent)}
              >
                {copied ? (
                  <Check size={14} className="p-0.5 rounded text-mf-accent transition-colors" />
                ) : (
                  <Copy
                    size={14}
                    className="p-0.5 rounded hover:bg-mf-hover/50 text-mf-text-secondary/60 hover:text-mf-text-primary transition-colors"
                  />
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="left">{copied ? 'Copied!' : 'Copy output'}</TooltipContent>
          </Tooltip>
        )}
        {!disabled && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0" tabIndex={0}>
                {open ? (
                  <Minimize2
                    size={14}
                    className="p-0.5 rounded hover:bg-mf-hover/50 text-mf-text-secondary/60 hover:text-mf-text-primary transition-colors"
                  />
                ) : (
                  <Maximize2
                    size={14}
                    className="p-0.5 rounded hover:bg-mf-hover/50 text-mf-text-secondary/60 hover:text-mf-text-primary transition-colors"
                  />
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="left">{open ? 'Collapse' : 'Expand'}</TooltipContent>
          </Tooltip>
        )}
      </button>
      {!open && subHeader}
      {open && children}
    </div>
  );
}
