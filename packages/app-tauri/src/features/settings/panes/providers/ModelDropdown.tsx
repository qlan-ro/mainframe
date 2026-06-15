import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../components/ui/tooltip';

type ModelOption = { id: string; label: string; description?: string };

function RowWithTooltip({ option, children }: { option: ModelOption; children: React.ReactElement }) {
  if (!option.description) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{option.description}</TooltipContent>
    </Tooltip>
  );
}

interface ModelDropdownProps {
  adapterId: string;
  value: string;
  options: ModelOption[];
  onChange: (id: string) => void;
}

/** Shadcn-style click-outside dropdown for selecting a provider's default model. */
export function ModelDropdown({ adapterId, value, options, onChange }: ModelDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const selected = options.find((o) => o.id === value);

  const trigger = (
    <button
      type="button"
      data-testid={`settings-${adapterId}-model-dropdown-trigger`}
      onClick={() => setOpen(!open)}
      className="w-full flex items-center justify-between bg-mf-input-bg border border-mf-border rounded-md px-3 py-1.5 text-sm text-mf-text-primary hover:border-mf-accent focus:outline-none focus:border-mf-accent cursor-pointer transition-colors"
    >
      <span className="truncate">{selected?.label ?? value}</span>
      <ChevronDown size={14} className="text-mf-text-secondary shrink-0" />
    </button>
  );

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-mf-text-secondary">Default Model</label>
      <div className="relative" ref={ref}>
        {selected ? <RowWithTooltip option={selected}>{trigger}</RowWithTooltip> : trigger}
        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-mf-panel-bg border border-mf-border rounded-md shadow-lg z-50 overflow-hidden">
            {options.map((opt) => (
              <RowWithTooltip key={opt.id} option={opt}>
                <button
                  type="button"
                  data-testid={`settings-${adapterId}-model-option-${opt.id}`}
                  onClick={() => {
                    onChange(opt.id);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                    opt.id === value
                      ? 'text-mf-text-primary bg-mf-hover'
                      : 'text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary'
                  }`}
                >
                  {opt.label}
                </button>
              </RowWithTooltip>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
