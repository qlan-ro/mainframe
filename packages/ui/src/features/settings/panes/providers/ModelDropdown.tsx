import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../../components/ui/dropdown-menu';

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

/** Provider default-model picker built on the shadcn DropdownMenu primitive. */
export function ModelDropdown({ adapterId, value, options, onChange }: ModelDropdownProps) {
  const selected = options.find((o) => o.id === value);

  return (
    <div className="space-y-1.5">
      <label className="text-label font-semibold text-muted-foreground">Default Model</label>
      <DropdownMenu>
        <RowWithTooltip option={selected ?? { id: value, label: value }}>
          <DropdownMenuTrigger
            data-testid={`settings-${adapterId}-model-dropdown-trigger`}
            className="h-[30px] w-full flex items-center justify-between bg-card border border-border rounded-md px-[11px] text-body text-foreground hover:border-primary focus:outline-none data-[state=open]:border-primary cursor-pointer transition-colors"
          >
            <span className="min-w-0 truncate">{selected?.label ?? value}</span>
            <ChevronDown size={14} className="text-muted-foreground shrink-0" />
          </DropdownMenuTrigger>
        </RowWithTooltip>
        <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
          {options.map((opt) => (
            <RowWithTooltip key={opt.id} option={opt}>
              <DropdownMenuItem
                data-testid={`settings-${adapterId}-model-option-${opt.id}`}
                onSelect={() => onChange(opt.id)}
                className={opt.id === value ? 'text-foreground' : 'text-muted-foreground'}
              >
                {opt.label}
              </DropdownMenuItem>
            </RowWithTooltip>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
