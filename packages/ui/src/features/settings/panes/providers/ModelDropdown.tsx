import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';

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
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium text-muted-foreground">Default Model</Label>
      <DropdownMenu>
        <RowWithTooltip option={selected ?? { id: value, label: value }}>
          <DropdownMenuTrigger
            data-testid={`settings-${adapterId}-model-dropdown-trigger`}
            className="flex h-8 w-full cursor-pointer items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-xs transition-colors outline-none hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:border-ring dark:bg-input/30"
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
