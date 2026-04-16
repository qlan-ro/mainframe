import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../ui/tooltip';

type Item = { id: string; label: string; description?: string };

function LabelWithTooltip({ item, children }: { item: Item; children: React.ReactNode }) {
  if (!item.description) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{item.description}</TooltipContent>
    </Tooltip>
  );
}

export function ComposerDropdown({
  items,
  value,
  onChange,
  disabled = false,
  icon,
  className,
  'data-tutorial': dataTutorial,
}: {
  items: Item[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  className?: string;
  'data-tutorial'?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const selected = items.find((i) => i.id === value);
  const triggerInner = (
    <>
      {icon}
      <span>{selected?.label ?? value}</span>
      <ChevronDown size={14} />
    </>
  );

  return (
    <div className="relative" ref={ref} data-tutorial={dataTutorial}>
      {selected ? (
        <LabelWithTooltip item={selected}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setOpen(!open)}
            className={`flex items-center gap-1 px-2 py-1 rounded-mf-input text-mf-small text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${className ?? ''}`}
          >
            {triggerInner}
          </button>
        </LabelWithTooltip>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(!open)}
          className={`flex items-center gap-1 px-2 py-1 rounded-mf-input text-mf-small text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${className ?? ''}`}
        >
          {triggerInner}
        </button>
      )}
      {open && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[140px] bg-mf-panel-bg border border-mf-border rounded-mf-input shadow-lg z-50">
          {items.map((item) => (
            <LabelWithTooltip key={item.id} item={item}>
              <button
                type="button"
                onClick={() => {
                  onChange(item.id);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-mf-small transition-colors ${
                  item.id === value
                    ? 'text-mf-text-primary bg-mf-hover'
                    : 'text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary'
                }`}
              >
                {item.label}
              </button>
            </LabelWithTooltip>
          ))}
        </div>
      )}
    </div>
  );
}
